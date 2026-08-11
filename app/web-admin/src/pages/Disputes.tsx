import { useState } from 'react'
import { api, ApiError } from '../api/client'
import { useApi } from '../lib/useApi'
import { avatarGradient, disputePill, formatDate, formatNaira, initials } from '../lib/format'
import type { Dispute, DisputeStatus } from '../api/types'
import PageHeader from '../components/PageHeader'
import Glass from '../components/ui/Glass'
import Button from '../components/ui/Button'
import StatusPill from '../components/ui/StatusPill'
import Modal from '../components/ui/Modal'
import Icon from '../components/Icon'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateView'

type Filter = 'ALL' | DisputeStatus

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'OPEN', label: 'Open' },
  { key: 'RESOLVED', label: 'Resolved' },
  { key: 'CLOSED', label: 'Closed' },
]

export default function Disputes() {
  const [filter, setFilter] = useState<Filter>('ALL')
  const { data, loading, error, reload, setData } = useApi(
    (signal) => api.disputes(filter, signal),
    [filter],
  )

  const [resolving, setResolving] = useState<Dispute | null>(null)
  const [resolution, setResolution] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const disputes = data ?? []
  const openCount = disputes.filter((d) => d.status === 'OPEN').length

  async function handleResolve(outcome: 'RESOLVED' | 'CLOSED') {
    if (!resolving) return
    setBusy(true)
    setActionError(null)
    try {
      const updated = await api.resolveDispute(resolving.id, outcome, resolution)
      setData((prev) => (prev ?? []).map((d) => (d.id === updated.id ? updated : d)))
      setResolving(null)
      setResolution('')
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  function openModal(d: Dispute) {
    setResolving(d)
    setResolution('')
    setActionError(null)
  }

  return (
    <>
      <PageHeader
        crumb="Operations / Disputes"
        title="Dispute management"
        sub={
          loading ? 'Loading…' : `${openCount} open dispute${openCount !== 1 ? 's' : ''} requiring review`
        }
      />

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`btn btn-sm ${filter === f.key ? 'btn-primary' : 'btn-glass'}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            {f.key === 'OPEN' && openCount > 0 && (
              <span className="badge" style={{ marginLeft: 6 }}>
                {openCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingState label="Loading disputes…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : disputes.length === 0 ? (
        <Glass>
          <EmptyState
            icon="alert"
            title="No disputes"
            sub={filter === 'ALL' ? 'Workers raise disputes on payments or timesheets here.' : `No ${filter.toLowerCase()} disputes.`}
          />
        </Glass>
      ) : (
        <Glass reveal delay="d1" className="tablewrap">
          <table className="dt">
            <thead>
              <tr>
                <th>Worker</th>
                <th>Type</th>
                <th>Entity</th>
                <th>Reason</th>
                <th>Raised</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {disputes.map((d) => {
                const pill = disputePill(d.status)
                const name = d.worker?.name ?? 'Worker'
                return (
                  <tr key={d.id}>
                    <td>
                      <div className="wname">
                        <span className="wav" style={{ background: avatarGradient(name) }}>
                          {initials(name)}
                        </span>
                        {name}
                      </div>
                    </td>
                    <td>
                      <span style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'capitalize' }}>
                        {d.entityType.toLowerCase()}
                      </span>
                    </td>
                    <td>
                      <div style={{ maxWidth: 180 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{d.entity?.title ?? '—'}</div>
                        {d.entity?.gross != null && (
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                            {formatNaira(d.entity.gross)} gross · {formatNaira(d.entity.net)} net
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      <span
                        title={d.reason}
                        style={{
                          display: 'block',
                          maxWidth: 220,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontSize: 13,
                          color: 'var(--text)',
                        }}
                      >
                        {d.reason}
                      </span>
                    </td>
                    <td style={{ color: 'var(--muted)', fontSize: 12 }}>{formatDate(d.createdAt)}</td>
                    <td>
                      <StatusPill variant={pill.variant} label={pill.label} />
                    </td>
                    <td>
                      {d.status === 'OPEN' ? (
                        <Button variant="glass" size="sm" icon="eye" onClick={() => openModal(d)}>
                          Review
                        </Button>
                      ) : (
                        <span
                          style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 140, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={d.resolution ?? undefined}
                        >
                          {d.resolution ?? '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Glass>
      )}

      <Modal
        open={!!resolving}
        title="Review dispute"
        subtitle={resolving ? `${resolving.worker?.name ?? 'Worker'} · ${resolving.entityType.toLowerCase()} · ${resolving.entity?.title ?? ''}` : undefined}
        onClose={() => { setResolving(null); setResolution('') }}
      >
        {resolving && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
            <div
              style={{
                background: 'rgba(251,172,52,.08)',
                border: '1px solid rgba(251,172,52,.25)',
                borderRadius: 10,
                padding: '12px 14px',
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--clay)', fontWeight: 600, marginBottom: 4 }}>
                Worker&apos;s reason
              </div>
              <div style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.5 }}>{resolving.reason}</div>
            </div>

            {resolving.entity?.gross != null && (
              <div style={{ display: 'flex', gap: 24, padding: '8px 0' }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>Gross</div>
                  <div style={{ fontWeight: 700 }}>{formatNaira(resolving.entity.gross)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>Net payout</div>
                  <div style={{ fontWeight: 700, color: 'var(--money)' }}>{formatNaira(resolving.entity.net)}</div>
                </div>
              </div>
            )}

            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
                Resolution note (optional)
              </label>
              <textarea
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="Explain the decision to the worker…"
                rows={3}
                style={{
                  width: '100%',
                  background: 'var(--surface)',
                  border: '1px solid var(--line-2)',
                  borderRadius: 8,
                  color: 'var(--text)',
                  fontSize: 14,
                  padding: '10px 12px',
                  resize: 'vertical',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {actionError && (
              <div className="login-error" role="alert">
                <Icon name="alert" size={15} />
                {actionError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Button
                variant="glass"
                size="sm"
                loading={busy}
                onClick={() => handleResolve('CLOSED')}
              >
                Close (reject)
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon="check"
                loading={busy}
                onClick={() => handleResolve('RESOLVED')}
              >
                Resolve (accept)
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
