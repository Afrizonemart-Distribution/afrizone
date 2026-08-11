import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import Button from '../components/ui/Button'
import Icon from '../components/Icon'
import Logo from '../components/Logo'
import './Login.css'

const DEV = import.meta.env.DEV

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  // dev-only convenience: surface the reset token + link the backend returns.
  const [devToken, setDevToken] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await api.passwordForgot(email.trim())
      setDevToken(res.devToken ?? null)
      setSent(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send reset link')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="glass glass-accent login-card rv in">
        <div className="login-brand">
          <Logo size={46} tone="light" tagline />
        </div>

        {sent ? (
          <>
            <h1>Check your email</h1>
            <p className="lede">
              If an account exists for <b>{email}</b>, we’ve sent a link to reset
              your password. The link expires in 30 minutes.
            </p>

            {DEV && devToken && (
              <div className="login-hint" style={{ marginTop: 6, textAlign: 'left' }}>
                Dev · reset token:{' '}
                <Link to={`/reset-password?token=${encodeURIComponent(devToken)}`}>
                  <b>{devToken.slice(0, 10)}…</b>
                </Link>
              </div>
            )}

            <Link
              to="/login"
              className="btn btn-glass"
              style={{ width: '100%', justifyContent: 'center', marginTop: 18 }}
            >
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <h1>Forgot password</h1>
            <p className="lede">
              Enter your admin email and we’ll send a reset link.
            </p>

            <form onSubmit={onSubmit} noValidate>
              <div className="field" style={{ marginBottom: 18 }}>
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
                icon="send"
                style={{ width: '100%' }}
              >
                Send reset link
              </Button>
            </form>

            <Link to="/login" className="login-link login-back">
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
