/**
 * Large withdrawals waiting for a person to compare faces (server:
 * routes/adminWithdrawals.ts). The selfie taken for the withdrawal sits next
 * to the one the account was verified with. Same person: send. Not: the money
 * goes back into their wallet and they are told why.
 */
import { useState } from 'react'
import { api, ApiError } from '../api/client'
import { useApi } from '../lib/useApi'
import { formatDate, formatNaira } from '../lib/format'
import type { WithdrawalCheck } from '../api/types'
import PageHeader from '../components/PageHeader'
import Glass from '../components/ui/Glass'
import Button from '../components/ui/Button'
import StatusPill from '../components/ui/StatusPill'
import Modal from '../components/ui/Modal'
import Textarea from '../components/ui/Textarea'
import AuthedImage from '../components/ui/AuthedImage'
import Icon from '../components/Icon'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateView'
import { Label } from '@/components/shadcn/label'

const face: React.CSSProperties = {
  width: 200,
  height: 200,
  objectFit: 'cover',
  borderRadius: 12,
  border: '1px solid var(--line-2)',
  display: 'block',
}

function Face({ url, caption }: { url: string | null; caption: string }) {
  return (
    <div>
      {url ? (
        <AuthedImage url={url} alt={caption} style={face} />
      ) : (
        <div style={{ ...face, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 12 }}>
          None on file
        </div>
      )}
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>{caption}</div>
    </div>
  )
}

export default function WithdrawalChecks() {
  const { data, loading, error, reload } = useApi((signal) => api.withdrawalChecks(signal))
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<WithdrawalCheck | null>(null)
  const [reason, setReason] = useState('')

  const rows = data ?? []

  async function approve(id: string) {
    setBusy(id)
    setActionError(null)
    try {
      await api.approveWithdrawal(id)
      reload()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not send it')
    } finally {
      setBusy(null)
    }
  }

  async function reject() {
    if (!rejecting) return
    setBusy(rejecting.id)
    setActionError(null)
    try {
      await api.rejectWithdrawal(rejecting.id, reason.trim())
      setRejecting(null)
      setReason('')
      reload()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not save that')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <PageHeader
        crumb="Operations / Withdrawal checks"
        title="Large withdrawals"
        sub="Each comes with a selfie taken for it. Compare it with the face the account was verified with before the money leaves."
      />

      {actionError && (
        <div className="login-error" role="alert" style={{ marginBottom: 16 }}>
          <Icon name="alert" size={15} />
          {actionError}
        </div>
      )}

      {loading ? (
        <LoadingState label="Loading…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : rows.length === 0 ? (
        <Glass>
          <EmptyState icon="lock" title="Nothing waiting" sub="Large withdrawals appear here with both selfies." />
        </Glass>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {rows.map((r) => (
            <Glass key={r.id}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <b style={{ fontSize: 16 }}>{formatNaira(r.amount)}</b>
                <span>to {r.worker.name}</span>
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>
                  {r.bankMasked} · asked {formatDate(r.createdAt)} · KYC {r.worker.kycStatus}
                </span>
                {r.identityHold && <StatusPill variant="danger" label="Identity case open" />}
              </div>
              <div style={{ display: 'flex', gap: 20, marginTop: 14, flexWrap: 'wrap' }}>
                <Face url={r.kycSelfieUrl} caption="Verified with" />
                <Face url={r.payoutSelfieUrl} caption="Taken for this withdrawal" />
              </div>
              {r.identityHold && (
                <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 10 }}>
                  Decide the case on Identity checks before sending: {r.identityHold}
                </p>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    setRejecting(r)
                    setReason('')
                  }}
                >
                  Not the same person
                </Button>
                <Button
                  variant="money"
                  size="sm"
                  icon="check"
                  loading={busy === r.id}
                  disabled={!!r.identityHold}
                  onClick={() => approve(r.id)}
                  title="Super Admin only"
                >
                  Same person: send
                </Button>
              </div>
            </Glass>
          ))}
        </div>
      )}

      <Modal
        open={rejecting !== null}
        title="Don't send this withdrawal"
        subtitle="The amount goes back into their wallet, and they are told the reason."
        onClose={() => setRejecting(null)}
      >
        <div className="field" style={{ marginBottom: 18 }}>
          <Label htmlFor="wd-reason">Reason they'll see</Label>
          <Textarea
            id="wd-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. The selfie was too dark to compare. Please try again in good light."
          />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button variant="glass" onClick={() => setRejecting(null)}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy === rejecting?.id} disabled={!reason.trim()} onClick={reject}>
            Don't send
          </Button>
        </div>
      </Modal>
    </>
  )
}
