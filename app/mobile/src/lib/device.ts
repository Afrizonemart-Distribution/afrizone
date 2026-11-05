/**
 * This install's own id, sent to the server once per session
 * (POST /api/me/device). The server compares it across accounts: two accounts
 * on one phone is shown to staff, never enforced, because families share
 * phones (server: services/identityGuard.ts).
 *
 * Random, not a hardware id: nothing here identifies the phone outside this
 * app. Kept in secure storage, so it survives logging out.
 */
import { api } from '../api/client';
import { getItem, setItem } from './storage';

const KEY = 'afz.deviceId';

function randomId(): string {
  const bytes = new Uint8Array(16);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return `d_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export async function deviceId(): Promise<string> {
  const existing = await getItem(KEY);
  if (existing) return existing;
  const id = randomId();
  await setItem(KEY, id);
  return id;
}

/** Best-effort: a failure here never gets in the way of using the app. */
export async function registerDevice(): Promise<void> {
  try {
    await api.registerDevice(await deviceId());
  } catch {
    /* next session tries again */
  }
}
