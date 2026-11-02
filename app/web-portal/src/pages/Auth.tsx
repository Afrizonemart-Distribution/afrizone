import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import Shell, { ErrorNote } from './Shell'
import { useAuth, homeFor } from '../lib/auth'
import { ApiError } from '../lib/api'
import type { AccountType } from '../lib/types'

/** Build-time switch; turn on once the server's AFRIZONE_LOGIN_ENABLED is. */
const AFRIZONE_LOGIN_ON = import.meta.env.VITE_AFRIZONE_LOGIN === 'true'

const TYPES: AccountType[] =['INDIVIDUAL', 'STORE', 'COURIER']

const COPY: Record<AccountType, { label: string; title: string; lede: string }> = {
  INDIVIDUAL: {
    label: 'Individual',
    title: 'Create your account',
    lede: 'You will confirm your identity right after, so you can start taking work.',
  },
  STORE: {
    label: 'AfriZoneMart Store',
    title: 'Create a store account',
    lede: 'Sign up, then we connect you to your store. Afrizone approves every store before it can take orders.',
  },
  COURIER: {
    label: 'Courier / Dispatch',
    title: 'Create a courier account',
    lede: 'Sign up to deliver orders. You will confirm your identity and add your licence right after.',
  },
}

function readType(raw: string | undefined): AccountType {
  // Never undefined. A deep link, a typo or a back-navigation must still know
  // what is being created, and INDIVIDUAL is the least-privileged of the three.
  // The server validates it again regardless.
  return TYPES.includes(raw as AccountType) ? (raw as AccountType) : 'INDIVIDUAL'
}

/* ─────────────────────────── Sign in ─────────────────────────── */

/**
 * No account-type picker here, deliberately. You should not have to declare
 * what you are in order to log in — the server already knows, and asking would
 * only create a way to answer wrongly.
 */
export function SignIn() {
  const { user, signIn, continueWithAfrizone } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [afzBusy, setAfzBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (user) return <Navigate to={homeFor(user.accountType)} replace />

  // Not async on purpose: continueWithAfrizone must start in the click's own
  // tick so its popup isn't blocked.
  function afrizone() {
    setAfzBusy(true)
    setError(null)
    continueWithAfrizone()
      .then((u) => nav(homeFor(u.accountType), { replace: true }))
      .catch((err) =>
        setError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not sign you in.'),
      )
      .finally(() => setAfzBusy(false))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const u = await signIn(email.trim(), password)
      // Routed by what the SERVER says this account is.
      nav(homeFor(u.accountType), { replace: true })
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not sign you in.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell>
      <div className="form-narrow">
        <p className="eyebrow">Welcome back</p>
        <h1 className="pt">Sign in</h1>
        <p className="lede">Whatever kind of account you have, it signs in here.</p>

        <div className="card">
          <form onSubmit={submit}>
            {error && <ErrorNote message={error} />}
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="pw">Password</label>
              <input id="pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <button className="btn" type="submit" disabled={busy || !email || !password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          {AFRIZONE_LOGIN_ON && (
            <>
              <div className="or-rule" role="separator">
                <span>or</span>
              </div>
              <button className="btn ghost" type="button" onClick={afrizone} disabled={afzBusy || busy}>
                {afzBusy ? 'Waiting for AfriZone…' : 'Continue with AfriZone'}
              </button>
              <p className="hint afz-hint">Use the account you shop with on afrizonemart.com.</p>
            </>
          )}
          <p className="alt">
            New here? <Link to="/">Choose your account type</Link>
          </p>
        </div>
      </div>
    </Shell>
  )
}

/* ─────────────────────────── Register ─────────────────────────── */

export function Register() {
  const { type } = useParams()
  const accountType = readType(type)
  const copy = COPY[accountType]
  const { user, register } = useAuth()
  const nav = useNavigate()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (user) return <Navigate to={homeFor(user.accountType)} replace />

  const valid = name.trim().length >= 2 && /^\S+@\S+\.\S+$/.test(email.trim()) && password.length >= 8

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      const u = await register(name.trim(), email.trim(), password, accountType)
      nav(homeFor(u.accountType), { replace: true })
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not create your account.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell>
      <div className="form-narrow">
        <p className="eyebrow">Get started</p>
        <h1 className="pt">{copy.title}</h1>
        <p className="lede">{copy.lede}</p>

        {/* The form says which account it is setting up, and offers a way back.
            A form that silently creates the wrong kind of account is the failure
            the landing page exists to prevent. */}
        <div className="typebar">
          <span>Setting up as</span>
          <b>{copy.label}</b>
          <Link to="/">Change</Link>
        </div>

        <div className="card">
          <form onSubmit={submit}>
            {error && <ErrorNote message={error} />}
            <div className="field">
              <label htmlFor="name">{accountType === 'INDIVIDUAL' ? 'Your full name' : 'Your name'}</label>
              <input id="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="pw">Password</label>
              <input id="pw" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              <span className="hint">At least 8 characters.</span>
            </div>
            <button className="btn" type="submit" disabled={busy || !valid}>
              {busy ? 'Creating…' : 'Create account'}
            </button>
          </form>
          <p className="alt">
            Already have an account? <Link to="/signin">Sign in</Link>
          </p>
        </div>
      </div>
    </Shell>
  )
}
