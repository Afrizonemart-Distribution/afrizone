import { useState } from 'react'
import { api, ApiError } from '../api/client'
import { useApi } from '../lib/useApi'
import { avatarGradient, formatDate, formatNaira, initials, timesheetPill } from '../lib/format'
import type { Timesheet } from '../api/types'
import PageHeader from '../components/PageHeader'
import Glass from '../components/ui/Glass'
import Button from '../components/ui/Button'
import StatusPill from '../components/ui/StatusPill'
import Modal from '../components/ui/Modal'
import EvidenceButton from '../components/EvidenceButton'
import Icon from '../components/Icon'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateView'
import Textarea from '../components/ui/Textarea'
import Input from '../components/ui/Input'
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

/** What was handed in, in the task's own terms. */
function handedIn(t: Timesheet): string {
  if (t.task?.payModel === 'PER_UNIT') return `${t.units ?? 0} ${t.task.unitLabel || 'units'}`
  return `${t.hours}h`
}

/**
 * Approving is a decision about proof, not a button press: every acceptance
 * check the task set is ticked here, and for per-unit work the reviewer says
 * how many units they accept. The server refuses anything less
 * (routes/timesheets.ts), so this only makes the decision visible.
 */
function ReviewModal({
  sheet,
  onClose,
  onDone,
}: {
  sheet: Timesheet
  onClose: () => void
  onDone: (updated: Timesheet) => void
}) {
  const criteria = sheet.task?.acceptanceCriteria ?? []
  const perUnit = sheet.task?.payModel === 'PER_UNIT'
  const [checked, setChecked] = useState<string[]>([])
  const [accepted, setAccepted] = useState(String(sheet.units ?? ''))
  const [note, setNote] = useState('')
  const [mode, setMode] = useState<'approve' | 'rework'>('approve')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const allChecked = criteria.every((c) => checked.includes(c))
  const acceptedNum = Number(accepted)
  const unitsOk = !perUnit || (Number.isInteger(acceptedNum) && acceptedNum >= 1 && acceptedNum <= (sheet.units ?? 0))
  const pay =
    perUnit && unitsOk && sheet.task?.rate != null
      ? formatNaira(acceptedNum * sheet.task.rate)
      : null

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const updated =
        mode === 'approve'
          ? await api.approveTimesheet(sheet.id, {
              checks: checked,
              acceptedUnits: perUnit ? acceptedNum : undefined,
              note: note.trim() || undefined,
            })
          : await api.reworkTimesheet(sheet.id, note.trim())
      onDone(updated)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the decision')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={`Check work · ${sheet.worker?.name ?? 'Worker'}`}
      subtitle={`${sheet.task?.title ?? 'Task'} · handed in ${handedIn(sheet)}`}
      onClose={onClose}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        {sheet.note && (
          <div>
            <Label>Their note</Label>
            <p style={{ margin: '4px 0 0', whiteSpace: 'pre-line' }}>{sheet.note}</p>
          </div>
        )}
        <div>
          <EvidenceButton taskId={sheet.taskId} workerId={sheet.workerId} />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant={mode === 'approve' ? 'primary' : 'glass'} size="sm" onClick={() => setMode('approve')}>
            Approve
          </Button>
          <Button variant={mode === 'rework' ? 'danger' : 'glass'} size="sm" onClick={() => setMode('rework')}>
            Send back
          </Button>
        </div>

        {mode === 'approve' && criteria.length > 0 && (
          <div style={{ display: 'grid', gap: 8 }}>
            <Label>Confirm each check</Label>
            {criteria.map((c) => (
              <label key={c} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={checked.includes(c)}
                  onChange={(e) =>
                    setChecked((prev) => (e.target.checked ? [...prev, c] : prev.filter((x) => x !== c)))
                  }
                  style={{ marginTop: 3 }}
                />
                <span>{c}</span>
              </label>
            ))}
          </div>
        )}

        {mode === 'approve' && perUnit && (
          <div className="field" style={{ maxWidth: 280 }}>
            <Label htmlFor="rv-units">
              {(sheet.task?.unitLabel || 'Units').replace(/^./, (x) => x.toUpperCase())} accepted (of {sheet.units ?? 0})
            </Label>
            <Input
              id="rv-units"
              className="tnum"
              type="number"
              min="1"
              max={sheet.units ?? undefined}
              value={accepted}
              onChange={(e) => setAccepted(e.target.value)}
            />
            {pay && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Pays {pay} before tax</div>}
          </div>
        )}

        <div className="field">
          <Label htmlFor="rv-note">{mode === 'approve' ? 'Note (optional)' : 'What needs fixing'}</Label>
          <Textarea
            id="rv-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={mode === 'approve' ? '' : 'The worker sees this. Be specific: which photos, which rows.'}
          />
        </div>

        {error && (
          <div className="login-error" role="alert">
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button variant="glass" onClick={onClose}>
            Cancel
          </Button>
          {mode === 'approve' ? (
            <Button variant="money" icon="check" loading={busy} disabled={!allChecked || !unitsOk} onClick={submit}>
              Approve and owe pay
            </Button>
          ) : (
            <Button variant="danger" loading={busy} disabled={!note.trim()} onClick={submit}>
              Send back to worker
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

export default function Timesheets() {
  const { data, loading, error, reload, setData } = useApi((signal) =>
    api.timesheets('SUBMITTED', signal),
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [disputeId, setDisputeId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [reviewing, setReviewing] = useState<Timesheet | null>(null)

  const sheets = data ?? []

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
        title="Check handed-in work"
        sub={
          loading
            ? 'Loading…'
            : `${sheets.length} waiting · proof, checks and GPS before pay · 24–48h SLA`
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
            title="Nothing waiting to be checked"
            sub="Handed-in work appears here with its SLA countdown."
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
                <TableHead>Handed in</TableHead>
                <TableHead>SLA</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sheets.map((t) => {
                const name = t.worker?.name ?? 'Worker'
                const pill = timesheetPill(t.status)
                const checks = t.task?.acceptanceCriteria?.length ?? 0
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
                    <TableCell>
                      {t.task?.title ?? '—'}
                      {checks > 0 && (
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                          {checks} check{checks === 1 ? '' : 's'} to confirm
                        </div>
                      )}
                    </TableCell>
                    <TableCell style={{ color: 'var(--muted)' }}>
                      {formatDate(t.periodStart)} → {formatDate(t.periodEnd)}
                    </TableCell>
                    <TableCell className="tnum" style={{ fontWeight: 700 }}>
                      {handedIn(t)}
                      {t.note && (
                        <div style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)', maxWidth: 240 }}>
                          “{t.note}”
                        </div>
                      )}
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
                          <Button variant="money" size="sm" onClick={() => setReviewing(t)}>
                            Check
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
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                          {t.status === 'REWORK' ? 'Sent back' : 'Resolved'}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Glass>
      )}

      {reviewing && (
        <ReviewModal
          sheet={reviewing}
          onClose={() => setReviewing(null)}
          onDone={(updated) => {
            setData((prev) => (prev ?? []).map((t) => (t.id === reviewing.id ? { ...t, ...updated } : t)))
            setReviewing(null)
          }}
        />
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
