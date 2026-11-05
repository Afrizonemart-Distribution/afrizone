import { Router, Response as ExpressResponse } from "express";
import { prisma } from "../prisma";
import { requireAuth, AuthedRequest, verifyToken, isAdmin } from "../auth";
import { uploadToR2, resolveUrl, getFileStream } from "../services/storage";
import { sniffFileType, isAllowedMime, IDENTITY_MIMES, DOCUMENT_MIMES } from "../util/fileType";

// ID and SELFIE are identity evidence and must be photographs. DOCS, CV and
// CREDENTIAL are supporting paperwork, where a PDF is the normal form - a
// scanned licence or a CV is far more often a PDF than a photo.
const DOC_TYPES = ["ID", "SELFIE", "DOCS", "CV", "CREDENTIAL", "PORTFOLIO", "PAYOUT_SELFIE"] as const;
const IDENTITY_DOC_TYPES: readonly string[] = ["ID", "SELFIE", "PAYOUT_SELFIE"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// The exact shape handleKycUpload generates: `${cuid}-${Date.now()}${ext}`.
// Deliberately an allow-list of characters rather than a list of dangerous
// ones - it admits nothing that could act as a path separator, a parent
// reference or a control character.
const SAFE_OBJECT_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// Uploads per user per rolling window. A real submission is one ID, one
// selfie and a handful of supporting documents; a worker who qualifies for
// every tier and retakes each photo several times still lands far below this.
// It exists to bound abuse, not to police normal use.
const UPLOAD_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_UPLOADS_PER_WINDOW = 30;

function notFound(): Response {
  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

const router = Router();

// GET /api/me/kyc/documents: list the worker's uploaded documents.
router.get("/", requireAuth, async (req: AuthedRequest, res: ExpressResponse) => {
  const docs = await prisma.kycDocument.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: "desc" },
  });
  res.json(
    docs.map((d) => ({
      id: d.id,
      docType: d.docType,
      filename: d.filename,
      url: resolveUrl(d.filename),
      createdAt: d.createdAt,
    }))
  );
});

// GET /api/me/kyc/documents/file/:filename is handled OUTSIDE this Express
// router entirely (see handleKycFileGet below + index.ts), for the same
// reason POST is: `file.body` off the R2 binding is a WHATWG ReadableStream,
// and Express's `res` (as adapted by httpServerHandler) is a Node stream,
// not a WHATWG WritableStream - `file.body.pipeTo(res)` doesn't throw, it
// just hangs forever (Node streams don't implement the Web Streams sink
// interface `pipeTo` writes to), until Workers' own hang-detection kills the
// request. Returning a raw `Response(file.body, ...)` from the top-level
// fetch handler sidesteps the Node/Web stream boundary entirely.

// POST /api/me/kyc/documents is handled OUTSIDE this Express router entirely
// (see handleKycUpload below + index.ts) - Workers' Request.formData() is
// used instead of multer, since multer's multipart parsing depends on
// Node-stream/busboy internals whose behaviour under httpServerHandler's
// Node-request adaptation isn't something Cloudflare documents as supported
// (their own file-upload examples always use request.formData(), never
// multer). The interception happens before Express ever sees the request,
// so this router only ever handles GET here.

/**
 * POST /api/me/kyc/documents: upload a KYC document image.
 * multipart/form-data: field `docType` (ID | SELFIE | DOCS) + file field `file`.
 * Called directly from index.ts's top-level fetch handler, before Express -
 * so auth (normally the `requireAuth` middleware) is re-implemented inline
 * here rather than reused, since there's no Express `req`/`res` at this point.
 */
export async function handleKycUpload(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  let payload: ReturnType<typeof verifyToken>;
  try {
    if (!token) throw new Error("Missing token");
    payload = verifyToken(token);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // QUOTA. This route had none, and it is the only authenticated endpoint that
  // writes to R2: a worker could upload 10 MB an unlimited number of times,
  // which is storage the platform pays for indefinitely, plus a KycDocument
  // row each time.
  //
  // Counted in the database rather than with the express-rate-limit instances
  // in index.ts, for two reasons. This request is intercepted before Express
  // and never reaches that middleware at all. And index.ts already documents
  // that the limiter's default memory store is per-isolate on Workers, so it
  // is approximate by construction - a durable count of the rows actually
  // written is both exact and survives isolate churn. The existing
  // KycDocument(userId) index serves it.
  //
  // Checked BEFORE request.formData(), which is what buffers the body: a
  // rejected upload should not cost 10 MB of memory to refuse.
  const since = new Date(Date.now() - UPLOAD_WINDOW_MS);
  const recentUploads = await prisma.kycDocument.count({
    where: { userId: payload.sub, createdAt: { gte: since } },
  });
  if (recentUploads >= MAX_UPLOADS_PER_WINDOW) {
    return new Response(
      JSON.stringify({
        error: "Too many uploads today. Please try again tomorrow, or contact support.",
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(Math.ceil(UPLOAD_WINDOW_MS / 1000)),
        },
      }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid form data" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const docType = form.get("docType");
  if (typeof docType !== "string" || !DOC_TYPES.includes(docType as (typeof DOC_TYPES)[number])) {
    return new Response(JSON.stringify({ error: `docType must be one of ${DOC_TYPES.join(", ")}` }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return new Response(JSON.stringify({ error: "No file uploaded" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (file.size > MAX_FILE_SIZE) {
    return new Response(JSON.stringify({ error: "File too large (max 10 MB)" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Decide the type from the BYTES, never from file.type - that is
  // client-supplied, and `startsWith("image/")` accepted image/svg+xml, which
  // is a script-bearing document that was then served back from this origin.
  const sniffed = sniffFileType(new Uint8Array(buffer));
  // Identity documents must be photographs; a PDF "selfie" is not a thing, and
  // narrowing here keeps the highest-risk format off the highest-trust path.
  // Written as an allow-list of the identity types rather than a check for one
  // supporting type, so adding a further supporting type later cannot
  // accidentally admit PDFs onto the identity path.
  const permitted = IDENTITY_DOC_TYPES.includes(docType) ? IDENTITY_MIMES : DOCUMENT_MIMES;
  if (!sniffed || !permitted.includes(sniffed.mime)) {
    return new Response(
      JSON.stringify({
          error: IDENTITY_DOC_TYPES.includes(docType)
          ? "Upload a photo (JPEG, PNG or WebP)"
          : "Upload a JPEG, PNG, WebP or PDF",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Extension comes from the sniffed type, not from the client's filename -
  // that filename previously fed straight into the storage key.
  const filename = `${payload.sub}-${Date.now()}${sniffed.ext}`;

  await uploadToR2(buffer, filename, sniffed.mime);

  const doc = await prisma.kycDocument.create({
    data: {
      userId: payload.sub,
      docType,
      filename,
      originalName: file.name,
      // The SNIFFED type, not the declared one. This value is later served as
      // a Content-Type, so it must never be attacker-chosen.
      mimeType: sniffed.mime,
      path: `r2://kyc/${filename}`,
    },
  });

  return new Response(
    JSON.stringify({
      id: doc.id,
      docType: doc.docType,
      filename: doc.filename,
      url: resolveUrl(doc.filename),
      createdAt: doc.createdAt,
    }),
    { status: 201, headers: { "Content-Type": "application/json" } }
  );
}

/**
 * Who may read a stored KYC document. ALLOW-BY-LIST: it enumerates the two
 * cases that GRANT access and refuses everything else, including role values
 * this file has never heard of.
 *
 * It replaces `if (!owns && payload.role === "WORKER")`, which enumerated the
 * one role it wanted to DENY and therefore granted every other role. That was
 * safe only by accident, because WORKER happened to be the sole non-admin
 * entry in ROLES. Adding one role there - COURIER is on the roadmap - would
 * silently have handed every holder of it read access to every worker's
 * government ID and selfie.
 *
 * Exported so the "unknown role is denied" property can be tested directly: it
 * cannot be exercised over HTTP, because verifyToken rejects any role that is
 * not already in ROLES.
 */
export function canReadKycDocument(
  requester: { sub: string; role?: string | null },
  doc: { userId: string } | null | undefined
): boolean {
  if (!doc) return false; // no row -> nothing to authorise
  if (doc.userId === requester.sub) return true; // the owner
  return isAdmin(requester.role); // ADMIN_ROLES only
}

/**
 * GET /api/me/kyc/documents/file/:filename: stream a document's bytes back,
 * after checking the requester owns it (admins may view any worker's).
 * Replaces the old express.static /uploads mount, which served local-disk
 * files with no auth check at all - this is a strictly narrower access
 * model, not just a storage-backend swap. Called directly from index.ts's
 * top-level fetch handler; see the note above for why this bypasses Express.
 */
export async function handleKycFileGet(request: Request, rawFilename: string): Promise<Response> {
  // Takes the RAW, still-percent-encoded path segment and decodes it here, so
  // that every way this can go wrong is handled in one place next to the code
  // that consumes the result.
  //
  // Two things the caller cannot do for us:
  //
  //  - decodeURIComponent THROWS a URIError on malformed input ("%zz"). It was
  //    previously called in the top-level fetch handler with nothing catching
  //    it, so any unauthenticated request to .../file/%zz took down the whole
  //    request with a 500 instead of a 404.
  //  - The route pattern excludes "/" from the segment, but "%2F" only becomes
  //    "/" AFTER that match, so the pattern never saw it. The key is checked
  //    against the shape the uploader actually generates, which forecloses
  //    separators, "..", null bytes and every other traversal form by
  //    construction rather than by blocklist.
  //
  // A traversing key could not actually reach R2 today - the KycDocument row
  // is resolved first, and filenames are server-generated, so nothing would
  // match. But that safety is a property of a DOWNSTREAM lookup, not of this
  // boundary, and it would evaporate the moment anything else consumed this
  // value. Validate at the edge.
  let filename: string;
  try {
    filename = decodeURIComponent(rawFilename);
  } catch {
    return notFound();
  }
  if (!SAFE_OBJECT_KEY.test(filename)) return notFound();

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  let payload: ReturnType<typeof verifyToken>;
  try {
    if (!token) throw new Error("Missing token");
    payload = verifyToken(token);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Resolve the row FIRST, then authorise against it. Two changes from the old
  // `!owns && role === "WORKER"` form:
  //
  //  - The lookup is by filename alone, so a document with NO backing row can
  //    no longer be streamed. Previously the query was scoped to the caller,
  //    was consulted only as a deny signal, and an admin-role token therefore
  //    reached the R2 read for any caller-supplied key - including objects
  //    under the kyc/ prefix that no KycDocument row points at.
  //  - The decision is allow-by-list, so an unrecognised role is refused
  //    rather than granted.
  //
  // filename is not unique in the schema, hence findFirst.
  const doc = await prisma.kycDocument.findFirst({ where: { filename } });
  if (!canReadKycDocument(payload, doc)) {
    // 404 rather than 403: a 403 would confirm the document exists to someone
    // not entitled to know that.
    return notFound();
  }

  const file = await getFileStream(filename);
  if (!file) return notFound();

  // Re-validate the stored type at serve time rather than trusting it. Rows
  // written before uploads were sniffed may carry an attacker-chosen mimeType,
  // and this response is same-origin with the API - so an unrecognised type is
  // downgraded to an inert one rather than echoed back.
  const safeType = isAllowedMime(file.contentType) ? file.contentType : "application/octet-stream";
  return new Response(file.body, {
    status: 200,
    headers: {
      "Content-Type": safeType,
      // Stop the browser second-guessing the type and executing the response.
      "X-Content-Type-Options": "nosniff",
      // Belt and braces: even if something script-bearing were served, this
      // forbids it running. This route is intercepted before Express, so
      // helmet never sees it and these headers must be set by hand.
      "Content-Security-Policy": "default-src 'none'; sandbox",
      // Never render in a frame on another origin.
      "X-Frame-Options": "DENY",
      // Private documents must not sit in shared caches.
      "Cache-Control": "private, no-store",
    },
  });
}

export default router;
