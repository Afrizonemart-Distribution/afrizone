/**
 * File storage: Cloudflare R2, via the native binding (env.BUCKET), not the
 * S3-compatible API - no AWS SDK, no signing. Replaces the old dual-mode
 * local-disk/S3 setup entirely: Workers have no persistent filesystem, so
 * local-disk mode literally cannot exist here, and R2's own binding is
 * simpler than routing through S3-compatible signing for an in-Worker
 * consumer.
 *
 * There is no "presigned URL" concept with the native binding. Instead,
 * `resolveUrl` points at an authenticated Worker route
 * (GET /api/me/kyc/documents/file/:filename, see routes/kycDocuments.ts)
 * that streams the object from R2 after checking the requester owns it -
 * stricter than the old setup, where local-disk files were served by
 * `express.static` with no auth at all.
 */

import { env } from "cloudflare:workers";

const KEY_PREFIX = "kyc/";

/** Upload a buffer to R2. Key format: kyc/<filename>. */
export async function uploadToR2(
  buffer: Buffer | ArrayBuffer,
  filename: string,
  contentType: string
): Promise<void> {
  await env.BUCKET.put(`${KEY_PREFIX}${filename}`, buffer, {
    httpMetadata: { contentType },
  });
}

/** Read a stored document's bytes back out of R2, for server-side processing
 * (e.g. base64-encoding for the Smile ID document verification call). */
export async function getFileBuffer(filename: string): Promise<Buffer> {
  const obj = await env.BUCKET.get(`${KEY_PREFIX}${filename}`);
  if (!obj) throw new Error(`File not found in storage: ${filename}`);
  return Buffer.from(await obj.arrayBuffer());
}

/** Stream a stored document straight through, for the authenticated file route. */
export async function getFileStream(
  filename: string
): Promise<{ body: ReadableStream; contentType: string | undefined } | null> {
  const obj = await env.BUCKET.get(`${KEY_PREFIX}${filename}`);
  if (!obj) return null;
  return { body: obj.body, contentType: obj.httpMetadata?.contentType };
}

// ── Evidence photos (services/evidence.ts) ──
// A prefix of their own, so a KYC key can never resolve to a work photo or the
// other way round, whatever either route is handed.
const EVIDENCE_PREFIX = "evidence/";

export async function putEvidence(key: string, bytes: ArrayBuffer | Buffer, contentType: string): Promise<void> {
  await env.BUCKET.put(`${EVIDENCE_PREFIX}${key}`, bytes, { httpMetadata: { contentType } });
}

export async function getEvidenceStream(
  key: string
): Promise<{ body: ReadableStream; contentType: string | undefined } | null> {
  const obj = await env.BUCKET.get(`${EVIDENCE_PREFIX}${key}`);
  if (!obj) return null;
  return { body: obj.body, contentType: obj.httpMetadata?.contentType };
}

/** The whole photo, for the AI check (services/proofCheck.ts). */
export async function getEvidenceBytes(key: string): Promise<{ bytes: Uint8Array; contentType: string | undefined } | null> {
  const obj = await env.BUCKET.get(`${EVIDENCE_PREFIX}${key}`);
  if (!obj) return null;
  return { bytes: new Uint8Array(await obj.arrayBuffer()), contentType: obj.httpMetadata?.contentType };
}

export async function deleteEvidence(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await env.BUCKET.delete(keys.map((k) => `${EVIDENCE_PREFIX}${k}`));
}

/** Relative URL the API's own authenticated route serves this file at. */
export function resolveUrl(filename: string): string {
  return `/api/me/kyc/documents/file/${filename}`;
}
