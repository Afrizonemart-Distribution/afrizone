import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * API base URL.
 *
 * - iOS simulator + web can reach the host machine via `localhost`.
 * - The Android emulator maps the host loopback to `10.0.2.2`, so `localhost`
 *   will NOT reach a backend running on the dev machine: we swap it here.
 * - On a physical device, set EXPO_PUBLIC_API_URL to your machine's LAN IP,
 *   e.g. `EXPO_PUBLIC_API_URL=http://192.168.1.20:4000/api npx expo start`.
 */
const DEFAULT_PORT = 4000;

function defaultBaseUrl(): string {
  if (Platform.OS === 'android') {
    return `http://10.0.2.2:${DEFAULT_PORT}/api`;
  }
  return `http://localhost:${DEFAULT_PORT}/api`;
}

const fromEnv =
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;

export const API_BASE_URL: string = fromEnv || defaultBaseUrl();

export const SECURE_TOKEN_KEY = 'afrizone.jwt';
export const SECURE_USER_KEY = 'afrizone.user';

/**
 * Google OAuth client ids for the worker "Continue with Google" flow.
 *
 * Each platform needs its own OAuth client id (see ../../GOOGLE_SETUP.md):
 *   web     -> EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID     / extra.googleWebClientId
 *   ios     -> EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID     / extra.googleIosClientId
 *   android -> EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID / extra.googleAndroidClientId
 *   expo    -> EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID    / extra.googleExpoClientId
 *
 * Values come from EXPO_PUBLIC_* env vars first, then fall back to
 * `Constants.expoConfig.extra` (app.json) so they can be filled without env vars.
 * When ALL are absent the Google button renders disabled with a
 * "Google sign-in not configured" note rather than crashing (mirrors admin).
 */
const extra = (Constants.expoConfig?.extra ?? {}) as {
  googleClientId?: string;
  googleWebClientId?: string;
  googleIosClientId?: string;
  googleAndroidClientId?: string;
  googleExpoClientId?: string;
};

function pick(...vals: Array<string | undefined>): string | undefined {
  const v = vals.find((x) => typeof x === 'string' && x.trim().length > 0);
  return v ? v.trim() : undefined;
}

export interface GoogleClientIds {
  web?: string;
  ios?: string;
  android?: string;
  expo?: string;
}

export const GOOGLE_CLIENT_IDS: GoogleClientIds = {
  web: pick(
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    extra.googleWebClientId,
    // back-compat: legacy single id is the web client id
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID,
    extra.googleClientId,
  ),
  ios: pick(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID, extra.googleIosClientId),
  android: pick(
    process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    extra.googleAndroidClientId,
  ),
  expo: pick(process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID, extra.googleExpoClientId),
};

/**
 * Back-compat single client id (= the web client id). Prefer GOOGLE_CLIENT_IDS.
 */
export const GOOGLE_CLIENT_ID: string | undefined = GOOGLE_CLIENT_IDS.web;

/**
 * Where a shared Talent Profile is viewed: `${PROFILE_SHARE_BASE}/<slug>`.
 * The public page lives on the web portal.
 */
export const PROFILE_SHARE_BASE: string = (
  process.env.EXPO_PUBLIC_PROFILE_SHARE_BASE ||
  'https://portal.parttime.afrizonemart.com/p'
).replace(/\/+$/, '');
