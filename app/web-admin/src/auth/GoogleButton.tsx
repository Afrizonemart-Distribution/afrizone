import { useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../api/client'
import type { LoginResponse } from '../api/types'
import { GOOGLE_CLIENT_ID, loadGoogleIdentity } from './google'
import './GoogleButton.css'

interface Props {
  /** called with a full session, or a 2FA challenge for staff with TOTP on */
  onSuccess: (res: LoginResponse) => void
  disabled?: boolean
}

/**
 * "Sign in with Google" control. Loads Google Identity Services lazily and only
 * when VITE_GOOGLE_CLIENT_ID is present. When the client id is absent, or the
 * backend reports 503 (GOOGLE_CLIENT_ID unset server-side), it renders a
 * disabled button with a subtle "not configured" note instead of crashing.
 */
export default function GoogleButton({ onSuccess, disabled }: Props) {
  const holderRef = useRef<HTMLDivElement | null>(null)
  const [notConfigured, setNotConfigured] = useState(!GOOGLE_CLIENT_ID)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const clientId = GOOGLE_CLIENT_ID
    if (!clientId) return
    let cancelled = false

    loadGoogleIdentity()
      .then((gis) => {
        if (cancelled || !holderRef.current) return
        gis.initialize({
          client_id: clientId,
          callback: async (resp) => {
            setError(null)
            setBusy(true)
            try {
              const res = await api.googleSignIn(resp.credential)
              onSuccess(res)
            } catch (err) {
              if (err instanceof ApiError && err.status === 503) {
                // Backend has no GOOGLE_CLIENT_ID: degrade gracefully.
                setNotConfigured(true)
              } else if (err instanceof ApiError) {
                setError(err.message)
              } else {
                setError('Google sign-in failed')
              }
            } finally {
              setBusy(false)
            }
          },
        })
        gis.renderButton(holderRef.current, {
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          text: 'signin_with',
          width: 356,
        })
        setReady(true)
      })
      .catch(() => {
        if (!cancelled) setNotConfigured(true)
      })

    return () => {
      cancelled = true
    }
  }, [onSuccess])

  if (notConfigured) {
    return (
      <div className="gbtn-wrap">
        <button
          type="button"
          className="btn btn-glass gbtn"
          disabled
          aria-disabled="true"
          title="Google SSO not configured"
        >
          <GoogleGlyph />
          Sign in with Google
        </button>
        <span className="gbtn-note" role="note">
          Google SSO not configured
        </span>
      </div>
    )
  }

  return (
    <div className="gbtn-wrap">
      {/* GIS renders its official button here once ready. */}
      <div ref={holderRef} className={`gbtn-holder ${ready ? 'on' : ''}`} aria-busy={busy} />
      {!ready && (
        <button type="button" className="btn btn-glass gbtn" disabled={disabled || busy}>
          <GoogleGlyph />
          {busy ? 'Signing in…' : 'Loading Google…'}
        </button>
      )}
      {error && (
        <span className="gbtn-note err" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

function GoogleGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.4 26.7 36 24 36c-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C39.9 36.4 44 31 44 24c0-1.3-.1-2.3-.4-3.5z"
      />
    </svg>
  )
}
