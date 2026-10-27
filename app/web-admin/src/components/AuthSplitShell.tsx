import type { ReactNode } from 'react'
import Logo from './Logo'

const POINTS = [
  'Review and approve worker applications',
  'Verify KYC documents before a worker goes live',
  'Release payments, net of withholding tax, in one place',
]

/**
 * Shared left brand panel + right form panel for the auth screens (Login,
 * ForgotPassword, ResetPassword). Layout/format follows a reference the user
 * brought (a Termii-style split login screen); colours are Afrizone's own.
 */
export default function AuthSplitShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth-split">
      <div className="auth-panel">
        <div className="auth-panel-brand">
          <Logo size={48} tone="dark" tagline overlap />
        </div>
        <div className="auth-panel-rule" />
        <div className="auth-panel-copy">
          <h2>
            Honest, flexible work
            <br />
            <span className="accent">across Africa.</span>
          </h2>
          <p>The operations console for AfriZone PartTime.</p>
          <div className="auth-panel-points">
            {POINTS.map((point) => (
              <div className="auth-panel-point" key={point}>
                <span className="dot" aria-hidden="true" />
                {point}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="auth-form-wrap">
        <div className="auth-form">{children}</div>
      </div>
    </div>
  )
}
