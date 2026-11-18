/**
 * Withdrawals waiting to be paid (server: routes/adminWithdrawals.ts). Every
 * withdrawal waits here until a Super Admin presses Pay; nothing is sent on a
 * Tasker's request alone. A large one also carries a selfie to compare with the
 * one the account was verified with. Pay sends it through AfriZoneMart's Squad
 * account; "Don't pay" puts the money back in their wallet with the reason.
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
import Input from '../components/ui/Input'
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
  const { data, loading, error, reload } = useApi((signal) => api.withdrawalChecks(signal, 'REVIEW'))
  const sent = useApi((signal) => api.withdrawalChecks(signal, 'PROCESSING'))
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<WithdrawalCheck | null>(null)
  const [reason, setReason] = useState('')
  const [manual, setManual] = useState<WithdrawalCheck | null>(null)
  const [transferRef, setTransferRef] = useState('')
  const [manualNote, setManualNote] = useState('')

  const rows = data ?? []

  async function approve(id: string) {
    setBusy(id)
    setActionError(null)
    try {
      await api.approveWithdrawal(id)
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not send it')
    } finally {
      setBusy(null)
      reload()
      sent.reload()
    }
  }

  async function recordManual() {
    if (!manual) return
    setBusy(manual.id)
    setActionError(null)
    try {
      await api.paidManually(manual.id, transferRef.trim(), manualNote.trim())
      setManual(null)
      setTransferRef('')
      setManualNote('')
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not record that')
      setManual(null)
    } finally {
      setBusy(null)
      reload()
    }
  }

  async function check(id: string) {
    setBusy(id)
    setActionError(null)
    try {
      await api.checkWithdrawal(id)
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not check it')
    } finally {
      setBusy(null)
      sent.reload()
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
        crumb="Operations / Withdrawals"
        title="Withdrawals"
        sub="Nothing is paid until you press Pay. Large ones come with a selfie: compare it with the face the account was verified with first."
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
          <EmptyState icon="lock" title="Nothing waiting" sub="Withdrawals Taskers ask for appear here until you pay them." />
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
              {r.hasSelfie && (
                <div style={{ display: 'flex', gap: 20, marginTop: 14, flexWrap: 'wrap' }}>
                  <Face url={r.kycSelfieUrl} caption="Verified with" />
                  <Face url={r.payoutSelfieUrl} caption="Taken for this withdrawal" />
                </div>
              )}
              {r.failureReason && (
                <p style={{ fontSize: 13, color: 'var(--danger, #b42318)', marginTop: 10 }}>Last try: {r.failureReason}</p>
              )}
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
                  {r.hasSelfie ? 'Not the same person' : "Don't pay"}
                </Button>
                <Button
                  variant="glass"
                  size="sm"
                  disabled={!!r.identityHold}
                  onClick={() => {
                    setManual(r)
                    setTransferRef('')
                    setManualNote('')
                  }}
                  title="Super Admin only"
                >
                  Paid by bank transfer
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
                  {r.hasSelfie ? 'Same person: pay' : `Pay ${formatNaira(r.amount)}`}
                </Button>
              </div>
            </Glass>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 18, margin: '28px 0 4px' }}>Sent, waiting for the bank</h2>
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 14px' }}>
        Checked with Squad every 5 minutes. Paid ones drop off this list; failed ones go back to the Tasker&rsquo;s wallet.
      </p>
      {sent.loading ? (
        <LoadingState label="Loading…" />
      ) : sent.error ? (
        <ErrorState message={sent.error} onRetry={sent.reload} />
      ) : (sent.data ?? []).length === 0 ? (
        <Glass>
          <EmptyState icon="check" title="Nothing in flight" sub="Payouts you send show here until the bank confirms them." />
        </Glass>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {(sent.data ?? []).map((r) => (
            <Glass key={r.id}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <b>{formatNaira(r.amount)}</b>
                <span>to {r.worker.name}</span>
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>
                  {r.bankMasked} · asked {formatDate(r.createdAt)}
                </span>
                <StatusPill variant="pending" label="With the bank" />
                <span style={{ flex: 1 }} />
                <Button variant="glass" size="sm" loading={busy === r.id} onClick={() => check(r.id)}>
                  Check now
                </Button>
              </div>
            </Glass>
          ))}
        </div>
      )}

      <Modal
        open={manual !== null}
        title="Paid by bank transfer"
        subtitle={
          manual
            ? `Record that Afrizone paid ${formatNaira(manual.amount)} to ${manual.worker.name} (${manual.bankMasked}) from the company account. Nothing is sent from here.`
            : ''
        }
        onClose={() => setManual(null)}
      >
        <div className="field" style={{ marginBottom: 14 }}>
          <Label htmlFor="wd-ref">Bank transfer reference (session ID)</Label>
          <Input
            id="wd-ref"
            value={transferRef}
            onChange={(e) => setTransferRef(e.target.value)}
            placeholder="From the bank app's receipt"
          />
        </div>
        <div className="field" style={{ marginBottom: 18 }}>
          <Label htmlFor="wd-note">Note (optional)</Label>
          <Textarea id="wd-note" value={manualNote} onChange={(e) => setManualNote(e.target.value)} />
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 14px' }}>
          Only once the money has actually left. The Tasker is told it was paid, with this reference.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button variant="glass" onClick={() => setManual(null)}>
            Cancel
          </Button>
          <Button
            variant="money"
            loading={busy === manual?.id}
            disabled={transferRef.trim().length < 4}
            onClick={recordManual}
          >
            Mark paid
          </Button>
        </div>
      </Modal>

      <Modal
        open={rejecting !== null}
        title="Don't pay this withdrawal"
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
