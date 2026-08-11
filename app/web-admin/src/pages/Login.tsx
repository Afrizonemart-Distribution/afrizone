import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { ApiError } from '../api/client'
import GoogleButton from '../auth/GoogleButton'
import Button from '../components/ui/Button'
import OtpInput from '../components/ui/OtpInput'
import Icon from '../components/Icon'
import Logo from '../components/Logo'
import './Login.css'

const DEV = import.meta.env.DEV

export default function Login() {
  const { user, login, verifyTwoFactor, applySession, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('admin@afrizone.work')
  const [password, setPassword] = useState('afrizone123')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // 2FA challenge step
  const [challenge, setChallenge] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)

  const from = (location.state as { from?: string } | null)?.from ?? '/'

  if (!loading && user) return <Navigate to={from} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await login(email, password)
      if (res.kind === '2fa') {
        setChallenge(res.challenge)
        setCode('')
      } else {
        navigate(from, { replace: true })
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function submitCode(value: string) {
    if (!challenge || verifying) return
    setError(null)
    setVerifying(true)
    try {
      await verifyTwoFactor(challenge, value)
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verification failed')
      setCode('')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="glass glass-accent login-card rv in">
        <div className="login-brand">
          <Logo size={46} tone="light" tagline />
        </div>

        {challenge ? (
          /* ===== Step 2: 2FA challenge ===== */
          <>
            <h1>Two-factor</h1>
            <p className="lede">
              Enter the 6-digit code from your authenticator app.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (code.length === 6) submitCode(code)
              }}
              noValidate
            >
              <div className="field" style={{ marginBottom: 18 }}>
                <OtpInput
                  value={code}
                  onChange={setCode}
                  onComplete={submitCode}
                  disabled={verifying}
                  autoFocus
                  ariaLabel="Two-factor authentication code"
                />
              </div>

              {error && (
                <div className="login-error" role="alert">
                  <Icon name="alert" size={15} />
                  {error}
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                loading={verifying}
                disabled={code.length !== 6}
                icon="shield"
                style={{ width: '100%' }}
              >
                Verify
              </Button>
            </form>

            <button
              type="button"
              className="login-link login-back"
              onClick={() => {
                setChallenge(null)
                setCode('')
                setError(null)
              }}
            >
              Use a different account
            </button>

            {DEV && (
              <div className="login-hint">
                Dev · bypass code <b>000000</b>
              </div>
            )}
          </>
        ) : (
          /* ===== Step 1: email + password ===== */
          <>
            <h1>Welcome back</h1>
            <p className="lede">Sign in to the operations console.</p>

            <form onSubmit={onSubmit} noValidate>
              <div className="field" style={{ marginBottom: 14 }}>
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  className="input"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <div className="login-row">
                <Link to="/forgot-password" className="login-link">
                  Forgot password?
                </Link>
              </div>

              {error && (
                <div className="login-error" role="alert">
                  <Icon name="alert" size={15} />
                  {error}
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                loading={submitting}
                icon="arrow-right"
                style={{ width: '100%' }}
              >
                Sign in
              </Button>
            </form>

            <div className="login-divider">
              <span>or</span>
            </div>

            <GoogleButton onSuccess={applySession} />

            <div className="login-hint">
              Demo · <b>admin@afrizone.work</b> / <b>afrizone123</b>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
