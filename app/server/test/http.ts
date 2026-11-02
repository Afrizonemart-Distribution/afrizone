// Thin SELF.fetch() wrapper shaped like supertest's res.status/res.body, so
// SELF dispatches through the real default-exported Worker handler in
// src/index.ts (the same routing, including the KYC upload/download
// interception) rather than importing Express's `app` directly.
import { SELF } from "cloudflare:test";

interface ApiResult {
  status: number;
  body: any;
}

async function toResult(res: Response): Promise<ApiResult> {
  const text = await res.text();
  let body: any;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body };
}

export async function apiGet(path: string, token?: string): Promise<ApiResult> {
  const res = await SELF.fetch(`http://local.test${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return toResult(res);
}

export async function apiPost(path: string, json?: unknown, token?: string): Promise<ApiResult> {
  return apiSend("POST", path, json, token);
}

export async function apiPatch(path: string, json?: unknown, token?: string): Promise<ApiResult> {
  return apiSend("PATCH", path, json, token);
}

export async function apiPut(path: string, json?: unknown, token?: string): Promise<ApiResult> {
  return apiSend("PUT", path, json, token);
}

async function apiSend(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  json?: unknown,
  token?: string
): Promise<ApiResult> {
  const res = await SELF.fetch(`http://local.test${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  return toResult(res);
}

export async function apiDelete(path: string, token?: string): Promise<ApiResult> {
  return apiSend("DELETE", path, undefined, token);
}
