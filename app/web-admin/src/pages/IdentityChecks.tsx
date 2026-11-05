/**
 * Accounts that share something only one person should have: a payout bank
 * account, an ID number, a phone (server: services/identityGuard.ts).
 *
 * Nothing here is automatic. A shared bank account or ID number pauses
 * withdrawals for every account on it until somebody decides; a shared phone
 * is only shown. The decision needs a written reason, because it lifts or
 * stops somebody's pay.
 */
import { useState } from 'react'
import { api, ApiError } from '../api/client'
import { useApi } from '../lib/useApi'
import { formatDate } from '../lib/format'
import type { IdentityFlag } from '../api/types'
import PageHeader from '../components/PageHeader'
import Glass from '../components/ui/Glass'
import Button from '../components/ui/Button'
import StatusPill from '../components/ui/StatusPill'
import Modal from '../components/ui/Modal'
import Textarea from '../components/ui/Textarea'
import Icon from '../components/Icon'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateView'
import { Label } from '@/components/shadcn/label'

const STATUS_PILL = {
  OPEN: { variant: 'pending', label: 'To decide' },
  CLEARED: { variant: 'ready', label: 'Cleared' },
  CONFIRMED: { variant: 'danger', label: 'Same person' },
} as const

export default function IdentityChecks() {
  const [showAll, setShowAll] = useState(false)
  const { data, loading, error, reload } = useApi(
    (signal) => api.identityFlags(showAll ? 'ALL' : 'OPEN', signal),
    [showAll],
  )
  const [deciding, setDeciding] = useState<{ flag: IdentityFlag; decision: 'CLEARED' | 'CONFIRMED' } | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [scanMsg, setScanMsg] = useState<string | null>(null)

  const flags = data ?? []

  async function decide() {
    if (!deciding) return
    setBusy(true)
    setActionError(null)
    try {
      await api.decideIdentityFlag(deciding.flag.id, deciding.decision, note.trim())
      setDeciding(null)
      setNote('')
      reload()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not save the decision')
    } finally {
      setBusy(false)
    }
  }

  async function scan() {
    setScanMsg(null)
    setActionError(null)
    try {
      const r = await api.scanIdentity()
      setScanMsg(`Compared ${r.scanned} saved bank accounts. ${r.openCases} case${r.openCases === 1 ? '' : 's'} to decide.`)
      reload()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Scan failed')
    }
  }

  return (
    <>
      <PageHeader
        crumb="People / Identity checks"
        title="One person, one account"
        sub="Accounts sharing a bank account, ID number or phone. Shared bank accounts and ID numbers pause withdrawals until you decide."
      />

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button variant="glass" size="sm" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show only cases to decide' : 'Show decided cases too'}
        </Button>
        <Button variant="glass" size="sm" icon="search" onClick={scan} title="Super Admin only">
          Compare all saved bank accounts
        </Button>
        {scanMsg && <span style={{ fontSize: 13, color: 'var(--muted)' }}>{scanMsg}</span>}
      </div>

      {actionError && (
        <div className="login-error" role="alert" style={{ marginBottom: 16 }}>
          <Icon name="alert" size={15} />
          {actionError}
        </div>
      )}

      {loading ? (
        <LoadingState label="Loading cases…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : flags.length === 0 ? (
        <Glass>
          <EmptyState
            icon="shield"
            title="Nothing to decide"
            sub="When two accounts share a bank account, ID number or phone, the case appears here."
          />
        </Glass>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {flags.map((f) => {
            const pill = STATUS_PILL[f.status]
            return (
              <Glass key={f.id}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <b style={{ fontSize: 15 }}>{f.label}</b>
                  <StatusPill variant={pill.variant} label={pill.label} />
                  {f.holdsPayouts ? (
                    <StatusPill variant="danger" label="Withdrawals paused" />
                  ) : f.severity === 'LOW' ? (
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>Shown only: families share phones</span>
                  ) : null}
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>Since {formatDate(f.createdAt)}</span>
                </div>

                <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                  {f.accounts.map((a) => (
                    <div
                      key={a.id}
                      style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 13, padding: '6px 0', borderTop: '1px solid var(--line)' }}
                    >
                      <b style={{ minWidth: 160 }}>{a.name}</b>
                      <span style={{ color: 'var(--muted)' }}>{[a.email, a.phone].filter(Boolean).join(' · ')}</span>
                      <span>KYC {a.kycStatus}</span>
                      {a.bankMasked && <span>{a.bankMasked}</span>}
                      <span style={{ color: 'var(--muted)' }}>
                        joined {formatDate(a.createdAt)} · {a.completedCount} jobs
                      </span>
                    </div>
                  ))}
                </div>

                {f.note && (
                  <p style={{ fontSize: 13, marginTop: 10, color: 'var(--muted)' }}>
                    Decided{f.decidedAt ? ` ${formatDate(f.decidedAt)}` : ''}: {f.note}
                  </p>
                )}

                {f.status === 'OPEN' && (
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                    <Button variant="money" size="sm" onClick={() => { setDeciding({ flag: f, decision: 'CLEARED' }); setNote('') }}>
                      Different people: clear
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => { setDeciding({ flag: f, decision: 'CONFIRMED' }); setNote('') }}>
                      Same person: keep paused
                    </Button>
                  </div>
                )}
              </Glass>
            )
          })}
        </div>
      )}

      <Modal
        open={deciding !== null}
        title={deciding?.decision === 'CLEARED' ? 'Clear this case' : 'Confirm: one person, several accounts'}
        subtitle={
          deciding?.decision === 'CLEARED'
            ? 'Withdrawals resume for these accounts. A new account sharing the same value reopens it.'
            : 'Withdrawals stay stopped on every account in this case.'
        }
        onClose={() => setDeciding(null)}
      >
        <div className="field" style={{ marginBottom: 18 }}>
          <Label htmlFor="idf-note">What did you check?</Label>
          <Textarea
            id="idf-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Called both numbers; spouses sharing one bank account"
          />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button variant="glass" onClick={() => setDeciding(null)}>
            Cancel
          </Button>
          <Button
            variant={deciding?.decision === 'CLEARED' ? 'money' : 'danger'}
            loading={busy}
            disabled={!note.trim()}
            onClick={decide}
          >
            Save decision
          </Button>
        </div>
      </Modal>
    </>
  )
}
