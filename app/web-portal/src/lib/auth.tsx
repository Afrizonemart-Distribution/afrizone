/**
 * Session state for the portal.
 *
 * THE ONE RULE HERE: the account type that decides which dashboard someone sees
 * comes from the SERVER, never from the card they tapped on the landing page.
 * The landing page picks a sign-up flow; it makes no claim about anybody. A
 * front door that could strand a person in the wrong dashboard because they
 * mis-tapped would be worse than not asking at all.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api, clearToken, getToken, setToken } from './api'
import { getAfrizoneIdentityToken } from './afrizone'
import type { AccountType, User } from './types'

interface AuthState {
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<User>
  /** Call straight from a click: it may open AfriZone sign-in in a popup. */
  continueWithAfrizone: () => Promise<User>
  register: (
    name: string,
    email: string,
    password: string,
    accountType: AccountType,
  ) => Promise<User>
  signOut: () => void
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  // Restore a session on load. A token that no longer resolves is cleared
  // rather than kept - a stale token that looks signed-in but 401s on every
  // request is worse than being signed out.
  useEffect(() => {
    const ctrl = new AbortController()
    if (!getToken()) {
      setLoading(false)
      return
    }
    api
      .me(ctrl.signal)
      .then((r) => setUser(r.user))
      .catch(() => {
        clearToken()
        setUser(null)
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    return () => ctrl.abort()
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await api.signIn(email, password)
    // Afrizone staff accounts can require 2FA. They have no business in the
    // portal anyway, so this is refused clearly rather than half-handled.
    if (res.requires2fa || !res.token || !res.user) {
      throw new Error('This account signs in on the Afrizone staff console, not here.')
    }
    setToken(res.token)
    setUser(res.user)
    return res.user
  }, [])

  const continueWithAfrizone = useCallback(async () => {
    const identityToken = await getAfrizoneIdentityToken()
    const res = await api.afrizoneSignIn(identityToken)
    // Same rule as signIn: staff accounts belong on the staff console.
    if (res.requires2fa || !res.token || !res.user) {
      throw new Error('This account signs in on the Afrizone staff console, not here.')
    }
    setToken(res.token)
    setUser(res.user)
    return res.user
  }, [])

  const register = useCallback(
    async (name: string, email: string, password: string, accountType: AccountType) => {
      const res = await api.register(name, email, password, accountType)
      if (!res.token || !res.user) throw new Error('Could not create your account.')
      setToken(res.token)
      setUser(res.user)
      return res.user
    },
    [],
  )

  const signOut = useCallback(() => {
    clearToken()
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, loading, signIn, continueWithAfrizone, register, signOut }),
    [user, loading, signIn, continueWithAfrizone, register, signOut],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth used outside AuthProvider')
  return v
}

/**
 * Where an account belongs after signing in. Reads the server's account type,
 * and this is the only place that decision is made.
 *
 * INDIVIDUAL goes to a page that points at the mobile app rather than a web
 * dashboard, because the worker experience is the app and duplicating it here
 * would be building the same product twice.
 */
export function homeFor(accountType: AccountType | undefined): string {
  if (accountType === 'STORE') return '/store'
  if (accountType === 'COURIER') return '/courier'
  return '/individual'
}
