import { httpServerHandler } from "cloudflare:node";
import express, { NextFunction, Request as ExpressRequest, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import authRouter from "./routes/auth";
import dashboardRouter from "./routes/dashboard";
import tasksRouter from "./routes/tasks";
import applicationsRouter from "./routes/applications";
import timesheetsRouter from "./routes/timesheets";
import paymentsRouter from "./routes/payments";
import workersRouter from "./routes/workers";
import jobsRouter from "./routes/jobs";
import candidatesRouter from "./routes/candidates";
import reportsRouter from "./routes/reports";
import settingsRouter from "./routes/settings";
import meRouter from "./routes/me";
import clockRouter from "./routes/clock";
import walletRouter from "./routes/wallet";
import contractsRouter from "./routes/contracts";
import disputesRouter, { adminRouter as adminDisputesRouter } from "./routes/disputes";
import organizationsRouter, { adminRouter as adminOrganizationsRouter } from "./routes/organizations";
import martRouter, { adminRouter as adminMartRouter } from "./routes/martIntegration";
import deliveriesRouter, { adminRouter as adminDeliveriesRouter } from "./routes/deliveries";
import ratingsRouter from "./routes/ratings";
import webhooksRouter from "./routes/webhooks";
import kycDocumentsRouter, { handleKycUpload, handleKycFileGet } from "./routes/kycDocuments";
import meTalentRouter from "./routes/meTalent";
import credentialsRouter from "./routes/credentials";
import searchRouter from "./routes/search";
import healthRouter from "./routes/health";
import fundingRouter from "./routes/funding";
import { purgeCustomerData } from "./services/deliveryPurge";
import { advanceRankedOffers } from "./services/ranking";
import presenceRouter from "./routes/presence";
import evidenceRouter, {
  adminRouter as adminEvidenceRouter,
  handleEvidenceUpload,
  handleEvidenceFileGet,
} from "./routes/evidence";
import adminAuditsRouter from "./routes/audits";

/** Must match wrangler.jsonc's triggers.crons entry character for character. */
const EVERY_MINUTE = "* * * * *";
import { SYSTEM_ACTORS } from "./util/audit";

const app = express();

app.set("trust proxy", 1);
// crossOriginResourcePolicy relaxed to "cross-origin": this API is deliberately
// consumed from other origins (web-admin, mobile web preview), including the
// authenticated KYC file route, which admin web loads directly in <img> tags.
// helmet's default "same-origin" policy would silently block those image loads.
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// CORS. The allowed origins come from CORS_ORIGIN; the localhost list below is
// only a fallback for when that is unset.
//
// THE FALLBACK IS ALMOST NEVER WHAT RUNS, WHICH IS A TRAP WORTH NAMING.
// wrangler.jsonc declares CORS_ORIGIN in `vars`, and vars apply to `wrangler
// dev` exactly as they do to `wrangler deploy` - so a local API run straight
// from a clean checkout is configured with the PRODUCTION origins, and every
// localhost origin is refused. Both browser clients (web-admin on 5173, the
// Expo web preview on 8081) fail against their own local backend, while the
// code here reads as though localhost were covered. Local development
// therefore needs CORS_ORIGIN set in app/server/.env, which is gitignored;
// .env.example carries the line to uncomment.
//
// Resolved lazily inside the origin callback, not at module scope: Workers
// only populate process.env from bindings once request handling begins, not
// at pure module-evaluation time - reading CORS_ORIGIN eagerly here always
// saw it as unset, permanently locking CORS to the localhost-only fallback
// regardless of what's actually configured for production. See
// src/services/paystack.ts for the same pattern in a service file.
app.use(
  cors({
    origin: (origin, callback) => {
      const corsOrigins = (
        process.env.CORS_ORIGIN ||
        "http://localhost:5173,http://localhost:4000,http://localhost:8081,http://localhost:19006"
      )
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean);
      // A disallowed origin is `false`, NOT an Error. Passing an Error here
      // rejects the whole request, which reached the error handler and came
      // back as a 500 - so an ordinary, correctly-refused cross-origin call
      // was indistinguishable from the server falling over, in the response
      // and in the logs. `false` simply omits the CORS headers, which is what
      // actually enforces the policy: the browser blocks the response. Nothing
      // is made more permissive by this - a denied origin is still denied.
      callback(null, !origin || corsOrigins.includes(origin));
    },
    credentials: true,
  })
);
// Paystack webhook needs the RAW body for HMAC signature verification:
// mount the raw parser on this path BEFORE the global JSON parser.
// Both of these authenticate with an HMAC over the RAW body, so the raw
// parser is mounted on their paths BEFORE the global JSON parser.
app.use("/api/webhooks/paystack", express.raw({ type: "*/*" }));
app.use("/api/integrations/mart/events", express.raw({ type: "*/*" }));
app.use(express.json());

// Rate limiting is disabled under the automated test suite (NODE_ENV=test):
// tests legitimately fire many requests at /api/auth in a short window, and
// the limiter's own behaviour is covered separately, not via the app tests.
//
// The NODE_ENV check is made INSIDE each request handler below, not by
// conditionally registering the middleware at module scope: Workers only
// populate process.env from bindings once request handling begins, not at
// pure module-evaluation time, so a module-scope `if (NODE_ENV !== "test")`
// always sees NODE_ENV as unset and would always register the limiters
// regardless of the real value. See src/services/paystack.ts for the same
// pattern in a service file.
//
// NOTE: express-rate-limit's default in-memory store is per-isolate. Workers
// can run many concurrent isolates, so this is a best-effort per-isolate
// backstop against abuse/scraping now, not a strict global rate limit the
// way it was on a single long-lived Railway process. Accepted trade-off for
// this migration; moving to Cloudflare's native rate-limiting rules or a
// Durable-Object-backed counter is a real follow-up, not done here.
//
// The limiters are also constructed lazily, not at module scope: MemoryStore
// calls setInterval() the moment rateLimit() runs, and Workers hard-forbid
// timers (and any async I/O or randomness) outside of a request handler -
// "Disallowed operation called within global scope." Deferring construction
// to the first real request keeps that setInterval call inside a valid
// request context instead of module-evaluation time.
//
// keyGenerator is also overridden: express-rate-limit's default reads
// req.ip, which httpServerHandler's Node-request adaptation leaves
// undefined (there's no real TCP socket behind a Workers request the way
// there is on a normal Node HTTP server) - throws ERR_ERL_UNDEFINED_IP_ADDRESS
// otherwise. Cloudflare's edge always sets CF-Connecting-IP on real traffic;
// falling back to a constant key in local dev (where that header is absent)
// just means dev testing shares one bucket, which is fine.
// The "local-dev" fallback is only ever correct off-edge. If CF-Connecting-IP
// were ever missing on real traffic, EVERY user would collapse into a single
// shared bucket and rate-limit each other out of the whole API - so make that
// misconfiguration loud instead of silent.
let warnedMissingClientIp = false;
const rateLimitKey = (req: ExpressRequest) => {
  const ip = req.headers["cf-connecting-ip"]?.toString();
  if (ip) return ip;
  if (process.env.NODE_ENV === "production" && !warnedMissingClientIp) {
    warnedMissingClientIp = true;
    console.error(
      "[ratelimit] CF-Connecting-IP absent in production: all clients now share " +
        "one rate-limit bucket. Check that this Worker is reached through the " +
        "Cloudflare edge and not a route that strips the header."
    );
  }
  return "local-dev";
};

let apiLimiter: ReturnType<typeof rateLimit> | undefined;
app.use("/api", (req, res, next) => {
  if (process.env.NODE_ENV === "test") return next();
  apiLimiter ??= rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: rateLimitKey,
  });
  return apiLimiter(req, res, next);
});

let authLimiter: ReturnType<typeof rateLimit> | undefined;
app.use("/api/auth", (req, res, next) => {
  if (process.env.NODE_ENV === "test") return next();
  // GET /api/auth/me is session *hydration*, not credential submission: the
  // admin SPA fires it on every full page load (twice under StrictMode in
  // dev). Counting it against the brute-force budget meant ~10 page loads
  // exhausted the window and started 429ing admins out of their own console.
  // Brute-force protection belongs on the endpoints that actually verify a
  // credential; /me only reads a session that requireAuth already validates.
  // It still falls under the general /api limiter above.
  if (req.method === "GET" && req.path === "/me") return next();
  authLimiter ??= rateLimit({
    windowMs: 15 * 60 * 1000,
    // 60, not 20: this prefix also covers the mobile OTP endpoints, and
    // Nigerian carrier CGNAT puts many real workers behind one shared IP, so a
    // tight per-IP budget locks strangers out of *signing up*. 60/15min is
    // still orders of magnitude too slow to brute-force a bcrypt-hashed
    // password, which is where the real protection lives.
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many auth requests. Try again later." },
    keyGenerator: rateLimitKey,
  });
  return authLimiter(req, res, next);
});

// Health + config
app.use("/api/health", healthRouter);

// Routers
app.use("/api/auth", authRouter);
app.use("/api/search", searchRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/applications", applicationsRouter);
app.use("/api/timesheets", timesheetsRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/workers", workersRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/candidates", candidatesRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/settings", settingsRouter);

// v3: worker-facing (mobile app)
app.use("/api/credentials", credentialsRouter);
// Going online for ranked delivery offers (services/ranking.ts).
app.use("/api/me/presence", presenceRouter);
// Proof-of-work photos. Upload and file reads are intercepted before Express,
// like KYC documents - see the fetch handler below.
app.use("/api/me/evidence", evidenceRouter);
app.use("/api/admin/evidence", adminEvidenceRouter);
// Every store audit finding, for the admin screen.
app.use("/api/admin/audits", adminAuditsRouter);
app.use("/api/me", meRouter);
// Skills + credentials, also under /api/me (see routes/meTalent.ts).
app.use("/api/me", meTalentRouter);
// GET only here - POST is intercepted before Express, see the fetch handler below.
app.use("/api/me/kyc/documents", kycDocumentsRouter);
app.use("/api/clock", clockRouter);
app.use("/api/wallet", walletRouter);
app.use("/api/contracts", contractsRouter);
// Organizations - stores and courier companies. Two mounts, because they are
// two different audiences: /api/organizations is a business's own people
// (gated on membership, see routes/organizations.ts), while
// /api/admin/organizations is Afrizone staff and is the only path that can
// approve or suspend one.
// AfriZoneMart tells us what happened; we decide what work it creates.
// The inbound route is signature-authenticated rather than session
// authenticated - Mart is a system, not a user.
app.use("/api/integrations/mart", martRouter);
app.use("/api/admin/mart", adminMartRouter);
// Delivery spans three audiences - the store, the assigned courier and staff -
// so its router owns paths under /api/organizations, /api/me and /api/deliveries
// rather than being split across three files that would each re-implement the
// same "may this caller touch this order?" check.
//
// MOUNTED BEFORE organizationsRouter deliberately. Express matches routers in
// order, and /api/organizations/:id/deliveries has to reach this one.
app.use("/api", deliveriesRouter);
app.use("/api/admin/deliveries", adminDeliveriesRouter);
app.use("/api/organizations", organizationsRouter);
app.use("/api/admin/organizations", adminOrganizationsRouter);
app.use("/api/disputes", adminDisputesRouter);
app.use("/api/me/disputes", disputesRouter);
app.use("/api/workers", ratingsRouter);
app.use("/api/webhooks", webhooksRouter);
app.use("/api/admin/funding", fundingRouter);

// 404
app.use((_req: ExpressRequest, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// Error handler, always returns { error } shape.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: ExpressRequest, res: Response, _next: NextFunction) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || "Internal server error" });
});

// Kept exported for supertest during the vitest-pool-workers migration window
// (see server/test/README or the migration plan) and for any future in-
// process testing needs; production traffic goes through the fetch handler
// below, not through app.listen().
export { app };

const PORT = 3000;
app.listen(PORT);
const workersHandler = httpServerHandler({ port: PORT });

export default {
  fetch(request, env, ctx) {
    // POST /api/me/kyc/documents bypasses Express/multer entirely: Workers'
    // Request.formData() replaces multer, since multer's multipart parsing
    // depends on Node-stream/busboy internals whose behaviour under
    // httpServerHandler's Node-request adaptation isn't something Cloudflare
    // documents as supported (their own file-upload examples always use
    // request.formData(), never multer). See routes/kycDocuments.ts.
    const url = new URL(request.url);
    // Proof-of-work photos, for the same reasons as the KYC routes below.
    if (url.pathname === "/api/me/evidence" && request.method === "POST") {
      return handleEvidenceUpload(request);
    }
    const evidenceFile = request.method === "GET" && url.pathname.match(/^\/api\/evidence\/([^/]+)\/file$/);
    if (evidenceFile) {
      return handleEvidenceFileGet(request, evidenceFile[1]);
    }
    if (url.pathname === "/api/me/kyc/documents" && request.method === "POST") {
      return handleKycUpload(request);
    }
    // GET /api/me/kyc/documents/file/:filename also bypasses Express: the R2
    // object's body is a WHATWG ReadableStream, and piping that into
    // Express's `res` (a Node stream under httpServerHandler) hangs instead
    // of erroring, since Node streams don't implement the Web Streams sink
    // interface `ReadableStream.pipeTo()` writes to. See routes/kycDocuments.ts.
    // The still-encoded segment is passed through as-is: decoding it here
    // threw an uncaught URIError on malformed input ("%zz"), and "%2F" only
    // becomes a separator AFTER this pattern has matched, so the pattern
    // cannot be what rejects it. Both are handled in handleKycFileGet.
    const fileMatch = request.method === "GET" && url.pathname.match(/^\/api\/me\/kyc\/documents\/file\/([^/]+)$/);
    if (fileMatch) {
      return handleKycFileGet(request, fileMatch[1]);
    }
    return workersHandler.fetch!(request, env, ctx);
  },

  /**
   * Scheduled work. The daily run below exists because
   * MART_INTEGRATION.md §5 makes a deletion promise that nothing else can keep.
   *
   * Everything else that could have been a job is derived at read time instead -
   * an expired posting, an expired credential - precisely so that a job failing
   * to run cannot leave a stale record looking live (see
   * services/contractState.ts). Retention is the case where that trick does not
   * work: you cannot derive the absence of data, and a customer's address is not
   * deleted by nobody looking at it.
   *
   * It is safe to miss a run. The sweep is idempotent, works from a cutoff
   * rather than from "since last time", and drains a backlog over consecutive
   * runs - so a Worker that was not invoked on Tuesday deletes Tuesday's rows on
   * Wednesday rather than skipping them.
   */
  async scheduled(controller, _env, ctx) {
    // Two schedules, one handler. The per-minute one moves ranked delivery
    // offers on to their next courier and forgets couriers whose app went
    // quiet (services/ranking.ts) - it is a notification, not a state change,
    // because whose turn it is is already derived at read time. Missing a run
    // delays one "it's your turn" push by a minute and nothing else.
    if (controller.cron === EVERY_MINUTE) {
      ctx.waitUntil(
        advanceRankedOffers()
          .then(async (r) => {
            await Promise.all(r.pushes);
            if (r.notified > 0 || r.swept > 0) {
              console.log(`[ranked-offers] told ${r.notified} courier(s), swept ${r.swept} stale presence row(s)`);
            }
          })
          .catch((e) => {
            console.error(`[ranked-offers] FAILED: ${e instanceof Error ? e.message : String(e)}`);
          })
      );
      return;
    }

    ctx.waitUntil(
      purgeCustomerData(SYSTEM_ACTORS.deliveryPurge)
        .then((r) => {
          console.log(
            `[delivery-purge] cleared ${r.purged} order(s), ${r.remaining} still due`
          );
        })
        // Never rethrown: a failed purge must be visible in the logs and in the
        // absence of an audit row, not by the Worker reporting an unhandled
        // rejection that says nothing about what it was doing.
        .catch((e) => {
          console.error(
            `[delivery-purge] FAILED: ${e instanceof Error ? e.message : String(e)}`
          );
        })
    );
  },
} satisfies ExportedHandler<Env>;
