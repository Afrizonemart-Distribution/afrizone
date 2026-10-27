import { useState } from 'react'
import { api, ApiError } from '../api/client'
import type { Blocker } from '../api/types'
import { useApi } from '../lib/useApi'
import { TIER_COLORS, TIER_LABELS, appPill, avatarGradient, initials, kycPill } from '../lib/format'
import PageHeader from '../components/PageHeader'
import StandingBadge from '../components/StandingBadge'
import Glass from '../components/ui/Glass'
import Button from '../components/ui/Button'
import StatusPill from '../components/ui/StatusPill'
import Modal from '../components/ui/Modal'
import Icon from '../components/Icon'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateView'
import Textarea from '../components/ui/Textarea'
import { Label } from '@/components/shadcn/label'
import { Avatar, AvatarFallback } from '@/components/shadcn/avatar'
import { Badge } from '@/components/shadcn/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/shadcn/table'

export default function Applications() {
  const { data, loading, error, reload, setData } = useApi((signal) =>
    api.applications('APPLIED', signal),
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  // Set when the server refuses an approval on requirements. Holds what the
  // admin needs to decide with, not just that something went wrong.
  const [override, setOverride] = useState<
    { id: string; name: string; message: string; blockers: Blocker[] } | null
  >(null)

  const apps = data ?? []

  async function approve(id: string, force = false) {
    setBusy(id)
    setActionError(null)
    try {
      const updated = await api.approveApplication(id, force)
      setData((prev) => (prev ?? []).map((a) => (a.id === id ? { ...a, ...updated } : a)))
      setOverride(null)
    } catch (err) {
      const body =
        err instanceof ApiError && err.body && typeof err.body === 'object'
          ? (err.body as { requiresOverride?: boolean; blockers?: Blocker[] })
          : null
      // A refusal the admin can answer, rather than an error they can only
      // read. They see which requirements are unmet and decide; the server
      // audits the override either way.
      if (body?.requiresOverride) {
        const app = apps.find((a) => a.id === id)
        setOverride({
          id,
          name: app?.worker?.name ?? 'This worker',
          message: err instanceof ApiError ? err.message : 'Requirements not met',
          blockers: body.blockers ?? [],
        })
      } else {
        setActionError(err instanceof ApiError ? err.message : 'Approve failed')
      }
    } finally {
      setBusy(null)
    }
  }

  async function confirmReject() {
    if (!rejectId) return
    setBusy(rejectId)
    setActionError(null)
    try {
      const updated = await api.rejectApplication(rejectId, reason.trim() || 'Not a fit')
      setData((prev) => (prev ?? []).map((a) => (a.id === rejectId ? { ...a, ...updated } : a)))
      setRejectId(null)
      setReason('')
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Reject failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <PageHeader
        crumb="Operations / Applications"
        title="Application review queue"
        sub={
          loading
            ? 'Loading…'
            : `${apps.length} applications awaiting approval, best applicant first within each task`
        }
      />

      {actionError && (
        <div className="login-error" role="alert" style={{ marginBottom: 16 }}>
          <Icon name="alert" size={15} />
          {actionError}
        </div>
      )}

      {loading ? (
        <LoadingState label="Loading applications…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : apps.length === 0 ? (
        <Glass>
          <EmptyState
            icon="check-circle"
            title="Queue is clear"
            sub="No applications are awaiting approval right now."
          />
        </Glass>
      ) : (
        <Glass reveal delay="d1" className="tablewrap">
          <Table className="dt">
            <TableHeader>
              <TableRow>
                <TableHead>Rank</TableHead>
                <TableHead>Applicant</TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>KYC</TableHead>
                <TableHead>Pitch</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {apps.map((a) => {
                const name = a.worker?.name ?? 'Worker'
                const pill = appPill(a.status)
                const tier = a.worker?.tiers?.[0]
                const kyc = a.worker?.kycStatus ? kycPill(a.worker.kycStatus) : null
                return (
                  <TableRow key={a.id}>
                    <TableCell style={{ whiteSpace: 'nowrap' }}>
                      {a.rank?.eligible ? (
                        <span title="Score from fit, reliability, rating and current load. It orders the queue; you still decide.">
                          <strong>#{a.rank.position}</strong>
                          <span style={{ color: 'var(--muted)', marginLeft: 6 }}>
                            {Math.round(a.rank.score * 100)}%
                          </span>
                        </span>
                      ) : a.rank ? (
                        <StatusPill variant="danger" label="Not qualified" />
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="wname">
                        <Avatar className="wav">
                          <AvatarFallback style={{ background: avatarGradient(name) }}>
                            {initials(name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            {name}
                            <StandingBadge standing={a.worker?.standing} />
                          </span>
                          {a.rank && a.rank.reasons.length > 0 && (
                            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                              {a.rank.reasons.join(' · ')}
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{a.task?.title ?? '—'}</TableCell>
                    <TableCell>
                      {tier ? (
                        <Badge variant="outline" className="tier">
                          <span className="d" style={{ background: TIER_COLORS[tier] }} />
                          {TIER_LABELS[tier]}
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>{kyc ? <StatusPill variant={kyc.variant} label={kyc.label} /> : '—'}</TableCell>
                    <TableCell style={{ maxWidth: 260, color: 'var(--muted)' }}>{a.pitch || '—'}</TableCell>
                    <TableCell>
                      <StatusPill variant={pill.variant} label={pill.label} />
                    </TableCell>
                    <TableCell>
                      {a.status === 'APPLIED' ? (
                        <div style={{ display: 'flex', gap: 8 }}>
                          <Button
                            variant="money"
                            size="sm"
                            loading={busy === a.id}
                            onClick={() => approve(a.id)}
                          >
                            Approve
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => {
                              setRejectId(a.id)
                              setReason('')
                            }}
                          >
                            Reject
                          </Button>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{a.reason || '—'}</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Glass>
      )}

      <Modal
        open={rejectId !== null}
        title="Reject application"
        subtitle="The reason is shared with the worker."
        onClose={() => setRejectId(null)}
      >
        <div className="field" style={{ marginBottom: 18 }}>
          <Label htmlFor="reject-reason">Reason</Label>
          <Textarea
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Tier requirements not met"
          />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button variant="glass" onClick={() => setRejectId(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            icon="x"
            loading={busy === rejectId}
            onClick={confirmReject}
          >
            Reject application
          </Button>
        </div>
      </Modal>

      {/* The gate refused, and the admin gets to answer it rather than just
          read it. They can see context the rules cannot - a licence renewed
          this morning, a document sent by WhatsApp - and a platform where a
          human can never override is one that strands people. The override is
          audited server-side, so it is a decision on the record, not a
          loophole. */}
      <Modal
        open={override !== null}
        title="Requirements not met"
        subtitle={override?.message ?? ''}
        onClose={() => setOverride(null)}
      >
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 14px', lineHeight: 1.6 }}>
          {override?.name} does not currently meet:
        </p>
        <ul style={{ listStyle: 'none', margin: '0 0 18px', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(override?.blockers ?? []).map((b, i) => (
            <li
              key={`${b.code}-${b.ref ?? i}`}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                fontSize: 13,
                color: 'var(--text)',
                padding: '10px 12px',
                border: '1px solid var(--line)',
                borderRadius: 10,
                background: 'var(--glass-2)',
              }}
            >
              <Icon name="alert" size={14} />
              <span>{b.message}</span>
            </li>
          ))}
        </ul>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 18px', lineHeight: 1.6 }}>
          You can still approve them. The override is recorded against your account.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button variant="glass" onClick={() => setOverride(null)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon="check"
            loading={busy === override?.id}
            onClick={() => override && approve(override.id, true)}
          >
            Approve anyway
          </Button>
        </div>
      </Modal>
    </>
  )
}
