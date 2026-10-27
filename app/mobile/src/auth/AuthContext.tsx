import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api } from '../api/client';
import { SECURE_TOKEN_KEY, SECURE_USER_KEY } from '../api/config';
import { getItem, setItem, deleteItem } from '../lib/storage';
import { stopBackground } from '../lib/presence';
import {
  isTwoFactorRequired,
  type AccountType,
  type User,
  type OtpRequestResponse,
  type AuthSuccess,
  type PasswordForgotResponse,
} from '../api/types';

/** Outcome of an email/password login attempt surfaced to the UI. */
export type LoginResult =
  | { kind: 'authenticated'; isNewUser: boolean }
  | { kind: '2fa'; challenge: string };

interface AuthState {
  user: User | null;
  token: string | null;
  /** True until we've checked secure storage on launch. */
  loading: boolean;
  /** POST /api/auth/otp/request: returns {sent, devCode?} (devCode only in dev/sim). */
  requestOtp: (phone: string) => Promise<OtpRequestResponse>;
  /**
   * POST /api/auth/otp/verify: stores token+user and returns whether this is a
   * brand-new (just-created) worker, so the caller can branch to KYC vs tabs.
   */
  verifyOtp: (phone: string, code: string) => Promise<boolean>;
  /**
   * POST /api/auth/login: email+password. Resolves to either an authenticated
   * session (token+user stored) OR a 2FA challenge (no token stored yet).
   */
  loginPassword: (email: string, password: string) => Promise<LoginResult>;
  /** POST /api/auth/2fa/verify: exchange a challenge+code; stores the session. */
  verifyTwoFactor: (challenge: string, code: string) => Promise<boolean>;
  /** POST /api/auth/register: create an account; stores session, returns isNewUser. */
  register: (
    name: string,
    email: string,
    password: string,
    accountType?: AccountType,
  ) => Promise<boolean>;
  /** PATCH /api/me: persist name/email to the backend AND the cached user. */
  updateProfile: (patch: { name?: string; email?: string }) => Promise<void>;
  /** POST /api/auth/google (context:"worker"): stores session, returns isNewUser. */
  googleSignIn: (idToken: string) => Promise<boolean>;
  /** POST /api/auth/password/forgot: neutral confirmation (+ devToken in sim). */
  passwordForgot: (email: string) => Promise<PasswordForgotResponse>;
  /** POST /api/auth/password/reset: set a new password from a reset token. */
  passwordReset: (token: string, password: string) => Promise<void>;
  /** POST /api/auth/2fa/setup (auth): pending secret + QR for Profile→Security. */
  twoFactorSetup: typeof api.twoFactorSetup;
  /** POST /api/auth/2fa/enable (auth): confirm; refreshes user.totpEnabled. */
  twoFactorEnable: (code: string) => Promise<void>;
  /** POST /api/auth/2fa/disable (auth): turn off; refreshes user.totpEnabled. */
  twoFactorDisable: (code: string) => Promise<void>;
  /** Merge fields into the cached user (e.g. after KYC submit) and re-persist. */
  updateUser: (patch: Partial<User>) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore persisted session on launch.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [t, u] = await Promise.all([
          getItem(SECURE_TOKEN_KEY),
          getItem(SECURE_USER_KEY),
        ]);
        if (active && t && u) {
          setToken(t);
          setUser(JSON.parse(u) as User);
        }
      } catch {
        // ignore corrupt storage
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  /** Persist + activate a full auth session (token + user). */
  const applySession = useCallback(async (res: AuthSuccess) => {
    await setItem(SECURE_TOKEN_KEY, res.token);
    await setItem(SECURE_USER_KEY, JSON.stringify(res.user));
    setToken(res.token);
    setUser(res.user);
  }, []);

  const requestOtp = useCallback(async (phone: string) => {
    return api.requestOtp(phone.trim());
  }, []);

  const verifyOtp = useCallback(
    async (phone: string, code: string) => {
      const res = await api.verifyOtp(phone.trim(), code.trim());
      await applySession(res);
      return res.isNewUser;
    },
    [applySession]
  );

  const loginPassword = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      const res = await api.login(email.trim(), password);
      if (isTwoFactorRequired(res)) {
        // 2FA challenge: do NOT store a token yet.
        return { kind: '2fa', challenge: res.challenge };
      }
      await applySession(res);
      return { kind: 'authenticated', isNewUser: res.isNewUser ?? false };
    },
    [applySession]
  );

  const verifyTwoFactor = useCallback(
    async (challenge: string, code: string) => {
      const res = await api.twoFactorVerify(challenge, code.trim());
      await applySession(res);
      return res.isNewUser ?? false;
    },
    [applySession]
  );

  const register = useCallback(
    async (name: string, email: string, password: string, accountType: AccountType = 'INDIVIDUAL') => {
      const res = await api.register(name.trim(), email.trim(), password, accountType);
      await applySession(res);
      return res.isNewUser ?? true;
    },
    [applySession]
  );

  const googleSignIn = useCallback(
    async (idToken: string) => {
      const res = await api.googleSignIn(idToken);
      await applySession(res);
      return res.isNewUser ?? false;
    },
    [applySession]
  );

  const passwordForgot = useCallback(async (email: string) => {
    return api.passwordForgot(email.trim());
  }, []);

  const passwordReset = useCallback(async (resetToken: string, password: string) => {
    await api.passwordReset(resetToken.trim(), password);
  }, []);

  const twoFactorSetup = useCallback(() => api.twoFactorSetup(), []);

  const updateUser = useCallback(async (patch: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      // Persist asynchronously; storage failures are non-fatal.
      void setItem(SECURE_USER_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const updateProfile = useCallback(
    async (patch: { name?: string; email?: string }) => {
      // Persist to the backend (PATCH /api/me), then mirror into the cached user.
      const updated = await api.patchMe(patch);
      await updateUser({ name: updated.name, email: updated.email });
    },
    [updateUser]
  );

  const twoFactorEnable = useCallback(
    async (code: string) => {
      await api.twoFactorEnable(code.trim());
      await updateUser({ totpEnabled: true });
    },
    [updateUser]
  );

  const twoFactorDisable = useCallback(
    async (code: string) => {
      await api.twoFactorDisable(code.trim());
      await updateUser({ totpEnabled: false });
    },
    [updateUser]
  );

  const signOut = useCallback(async () => {
    // Whoever signs in next must not be located on this account's behalf.
    await stopBackground();
    await deleteItem(SECURE_TOKEN_KEY);
    await deleteItem(SECURE_USER_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      token,
      loading,
      requestOtp,
      verifyOtp,
      loginPassword,
      verifyTwoFactor,
      register,
      googleSignIn,
      passwordForgot,
      passwordReset,
      twoFactorSetup,
      twoFactorEnable,
      twoFactorDisable,
      updateUser,
      updateProfile,
      signOut,
    }),
    [
      user,
      token,
      loading,
      requestOtp,
      verifyOtp,
      loginPassword,
      verifyTwoFactor,
      register,
      googleSignIn,
      passwordForgot,
      passwordReset,
      twoFactorSetup,
      twoFactorEnable,
      twoFactorDisable,
      updateUser,
      updateProfile,
      signOut,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
