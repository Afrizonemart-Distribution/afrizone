import { useState } from 'react'
import { api, ApiError } from '../api/client'
import { useApi } from '../lib/useApi'
import { avatarGradient, formatDate, initials, timesheetPill } from '../lib/format'
import PageHeader from '../components/PageHeader'
import Glass from '../components/ui/Glass'
import Button from '../components/ui/Button'
import StatusPill from '../components/ui/StatusPill'
import Modal from '../components/ui/Modal'
import EvidenceButton from '../components/EvidenceButton'
import Icon from '../components/Icon'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateView'
import Textarea from '../components/ui/Textarea'
import { Label } from '@/components/shadcn/label'
import { Avatar, AvatarFallback } from '@/components/shadcn/avatar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/shadcn/table'

function slaPill(hoursLeft?: number) {
  if (hoursLeft == null) return null
  const variant = hoursLeft <= 6 ? 'danger' : hoursLeft <= 12 ? 'pending' : 'ready'
  return <StatusPill variant={variant} label={`${Math.max(0, Math.round(hoursLeft))}h left`} />
}

export default function Timesheets() {
  const { data, loading, error, reload, setData } = useApi((signal) =>
    api.timesheets('SUBMITTED', signal),
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [disputeId, setDisputeId] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const sheets = data ?? []

  async function approve(id: string) {
    setBusy(id)
    setActionError(null)
    try {
      const updated = await api.approveTimesheet(id)
      setData((prev) => (prev ?? []).map((t) => (t.id === id ? { ...t, ...updated } : t)))
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Approve failed')
    } finally {
      setBusy(null)
    }
  }

  async function confirmDispute() {
    if (!disputeId) return
    setBusy(disputeId)
    setActionError(null)
    try {
      const updated = await api.disputeTimesheet(disputeId, reason.trim() || 'Hours mismatch')
      setData((prev) => (prev ?? []).map((t) => (t.id === disputeId ? { ...t, ...updated } : t)))
      setDisputeId(null)
      setReason('')
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Dispute failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <PageHeader
        crumb="Operations / Timesheets"
        title="Timesheet approval"
        sub={
          loading
            ? 'Loading…'
            : `${sheets.length} submitted · GPS & clock logs · 24–48h SLA`
        }
      />

      {actionError && (
        <div className="login-error" role="alert" style={{ marginBottom: 16 }}>
          <Icon name="alert" size={15} />
          {actionError}
        </div>
      )}

      {loading ? (
        <LoadingState label="Loading timesheets…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : sheets.length === 0 ? (
        <Glass>
          <EmptyState
            icon="clock"
            title="No timesheets to review"
            sub="Submitted timesheets appear here with their SLA countdown."
          />
        </Glass>
      ) : (
        <Glass reveal delay="d1" className="tablewrap">
          <Table className="dt">
            <TableHeader>
              <TableRow>
                <TableHead>Worker</TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>SLA</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sheets.map((t) => {
                const name = t.worker?.name ?? 'Worker'
                const pill = timesheetPill(t.status)
                return (
                  <TableRow key={t.id}>
                    <TableCell>
                      <div className="wname">
                        <Avatar className="wav">
                          <AvatarFallback style={{ background: avatarGradient(name) }}>
                            {initials(name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          {name}
                          {t.gpsNote && (
                            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t.gpsNote}</div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{t.task?.title ?? '—'}</TableCell>
                    <TableCell style={{ color: 'var(--muted)' }}>
                      {formatDate(t.periodStart)} → {formatDate(t.periodEnd)}
                    </TableCell>
                    <TableCell className="tnum" style={{ fontWeight: 700 }}>
                      {t.hours}h
                      {t.clock && t.clock.offline > 0 && (
                        <div
                          style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}
                          title="Clocked with no signal and sent later, so the time is the phone's"
                        >
                          {t.clock.offline} of {t.clock.events} clock times recorded offline
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{slaPill(t.slaHoursLeft) ?? '—'}</TableCell>
                    <TableCell>
                      <StatusPill variant={pill.variant} label={pill.label} />
                    </TableCell>
                    <TableCell>
                      {t.status === 'SUBMITTED' ? (
                        <div style={{ display: 'flex', gap: 8 }}>
                          <EvidenceButton taskId={t.taskId} workerId={t.workerId} />
                          <Button
                            variant="money"
                            size="sm"
                            loading={busy === t.id}
                            onClick={() => approve(t.id)}
                          >
                            Approve
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => {
                              setDisputeId(t.id)
                              setReason('')
                            }}
                          >
                            Dispute
                          </Button>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Resolved</span>
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
        open={disputeId !== null}
        title="Dispute timesheet"
        subtitle="Flag the hours for the worker to clarify."
        onClose={() => setDisputeId(null)}
      >
        <div className="field" style={{ marginBottom: 18 }}>
          <Label htmlFor="dispute-reason">Reason</Label>
          <Textarea
            id="dispute-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Clock-out outside geofence"
          />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button variant="glass" onClick={() => setDisputeId(null)}>
            Cancel
          </Button>
          <Button variant="danger" icon="alert" loading={busy === disputeId} onClick={confirmDispute}>
            Raise dispute
          </Button>
        </div>
      </Modal>
    </>
  )
}
