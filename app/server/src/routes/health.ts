import { Router, Request, Response } from "express";
import { env } from "cloudflare:workers";
import { isSmileConfigured } from "../services/smileIdentity";

const router = Router();

// GET /api/health: basic liveness check (public)
router.get("/", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "afrizone-server", time: new Date().toISOString() });
});

// GET /api/health/config: shows which services are live vs simulated (public)
// Useful during initial setup to know exactly what still needs to be configured.
router.get("/config", (_req: Request, res: Response) => {
  const jwt = process.env.JWT_SECRET ?? "";

  const services = {
    database: {
      ok: !!env.DB,
      provider: "d1",
      note: env.DB ? "Cloudflare D1 bound." : "D1 binding (env.DB) missing.",
    },
    jwt: {
      ok: jwt.length >= 32,
      note:
        jwt === "dev-secret-change-me"
          ? "INSECURE: using default dev secret. Rotate immediately."
          : jwt.length < 32
          ? "JWT_SECRET is too short (< 32 chars)."
          : "OK.",
    },
    paystack: {
      ok: !!process.env.PAYSTACK_SECRET,
      mode: process.env.PAYSTACK_SECRET ? "live" : "simulated",
      note: process.env.PAYSTACK_SECRET
        ? "Live payouts enabled."
        : "Simulated: withdrawals stay PROCESSING. Set PAYSTACK_SECRET to enable real transfers.",
    },
    sms: {
      ok: !!process.env.SMS_PROVIDER && !!process.env.TERMII_API_KEY,
      provider: process.env.SMS_PROVIDER || "simulated",
      note: process.env.SMS_PROVIDER
        ? `${process.env.SMS_PROVIDER} configured.`
        : "Simulated: devCode returned in OTP response, master code 123456 active. Set SMS_PROVIDER + keys.",
    },
    google: {
      ok: !!(process.env.GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_CLIENT_ID),
      note:
        process.env.GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
          ? "Google SSO enabled."
          : "Disabled: SSO buttons show 'not configured'. Set GOOGLE_WEB_CLIENT_ID to enable.",
    },
    smileIdentity: {
      ok: isSmileConfigured(),
      note: isSmileConfigured()
        ? "Document Verification (ID + selfie) enabled."
        : "Simulated: KYC relies on manual admin review only. Set SMILE_PARTNER_ID + SMILE_API_KEY to enable.",
    },
    // Email goes through Resend (services/email.ts); SMTP_URL was never read.
    email: {
      ok: !!process.env.RESEND_API_KEY,
      note: process.env.RESEND_API_KEY
        ? "Resend configured: password resets and job alerts are emailed."
        : "Not sending: password resets and job alerts are not emailed. Set RESEND_API_KEY.",
    },
    storage: {
      ok: !!env.BUCKET,
      provider: "r2",
      note: env.BUCKET ? "Cloudflare R2 bound." : "R2 binding (env.BUCKET) missing.",
    },
  };

  const criticalIssues = [
    !services.jwt.ok && "JWT_SECRET insecure or missing",
    !services.database.ok && "D1 binding missing",
    !services.storage.ok && "R2 binding missing",
  ].filter(Boolean);

  res.json({
    ready: criticalIssues.length === 0,
    criticalIssues,
    services,
  });
});

export default router;
