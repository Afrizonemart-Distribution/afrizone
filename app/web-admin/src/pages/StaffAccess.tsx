/**
 * Staff access: the people who run Part Time (2026-11-25).
 *
 * A Part Time admin (SUPER_ADMIN) adds staff by name, work email and role;
 * they get an email to set their password, then sign in here. No
 * Afrizonemart account involved. Server: routes/staffAccess.ts.
 *
 * Layout follows two 21st.dev patterns, rebuilt in the console's own
 * components: a members table that says what it won't do before you try
 * (yourself, the last admin) and an invite form with a sent confirmation.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import PageHeader from '../components/PageHeader'
import Glass from '../components/ui/Glass'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Input from '../components/ui/Input'
import StatusPill from '../components/ui/StatusPill'
import Icon from '../components/Icon'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateView'
import { Label } from '@/components/shadcn/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/shadcn/table'
import { ApiError, api } from '../api/client'
import type { StaffMember, StaffRole } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { formatDate } from '../lib/format'

const ROLES: { role: StaffRole; label: string; does: string }[] = [
  { role: 'TASK_MANAGER', label: 'Task manager', does: 'Posts tasks, approves applications, timesheets and finished work, handles disputes.' },
  { role: 'HR_ADMIN', label: 'Verification admin', does: 'Reviews KYC, identity checks and credentials; runs hiring and talent pools.' },
  { role: 'SUPER_ADMIN', label: 'Admin', does: 'Everything, including payments, withdrawals, settings and Staff access.' },
]
const roleLabel = (r: string) => ROLES.find((x) => x.role === r)?.label ?? r

const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback)

export default function StaffAccess() {
  const { user } = useAuth()
  const [staff, setStaff] = useState<StaffMember[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<StaffMember | null>(null)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoadErr(null)
    api
      .staffList()
      .then((r) => setStaff(r.staff))
      .catch((e) => setLoadErr(errText(e, 'Could not load staff')))
  }, [])
  useEffect(load, [load])

  const admins = useMemo(() => (staff ?? []).filter((s) => s.role === 'SUPER_ADMIN').length, [staff])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (staff ?? []).filter((s) => !q || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q))
  }, [staff, query])

  return (
    <>
      <PageHeader
        crumb="People / Staff access"
        title="Staff access"
        sub="The people who run Part Time. Add them with their work email; they get an email to set a password, then sign in here."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setAdding(true)} disabled={!staff}>
            Add staff
          </Button>
        }
      />

      {notice && (
        <Glass style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="check-circle" size={16} />
          <span style={{ flex: 1, fontSize: 13.5 }}>{notice}</span>
          <Button size="sm" variant="glass" onClick={() => setNotice(null)}>
            Dismiss
          </Button>
        </Glass>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 14 }}>
        {ROLES.map((r) => (
          <Glass key={r.role} style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <b style={{ fontSize: 13.5 }}>{r.label}</b>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{(staff ?? []).filter((s) => s.role === r.role).length}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, lineHeight: 1.45 }}>{r.does}</div>
          </Glass>
        ))}
      </div>

      {loadErr ? (
        <ErrorState message={loadErr} onRetry={load} />
      ) : !staff ? (
        <LoadingState label="Loading staff…" />
      ) : (
        <>
          <div style={{ marginBottom: 10, maxWidth: 360 }}>
            <Input aria-label="Search staff" placeholder="Search name or email" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {visible.length === 0 ? (
            <Glass>
              <EmptyState icon="users" title={staff.length ? 'No staff match' : 'No staff yet'} sub={staff.length ? 'Try another search.' : 'Add the people who will post tasks, approve work and review KYC.'} />
            </Glass>
          ) : (
            <Glass className="tablewrap">
              <Table className="dt">
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((s) => {
                    const isMe = s.id === user?.id
                    return (
                      <TableRow key={s.id}>
                        <TableCell>
                          <b>{s.name}</b>
                          {isMe && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>(you)</span>}
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.email}</div>
                        </TableCell>
                        <TableCell>{roleLabel(s.role)}</TableCell>
                        <TableCell>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {s.canSignIn ? <StatusPill variant="ready" label="Active" /> : <StatusPill variant="pending" label="Invite sent" />}
                            {s.canSignIn && !s.twoFactor && <StatusPill variant="review" label="No 2FA" />}
                          </div>
                        </TableCell>
                        <TableCell>{formatDate(s.createdAt)}</TableCell>
                        <TableCell style={{ textAlign: 'right' }}>
                          {isMe ? (
                            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Another admin manages you</span>
                          ) : (
                            <Button size="sm" variant="glass" onClick={() => setEditing(s)}>
                              Manage
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Glass>
          )}
        </>
      )}

      {adding && (
        <AddStaffModal
          onClose={() => setAdding(false)}
          onAdded={(m, sent) => {
            setStaff((list) => [...(list ?? []), m])
            setAdding(false)
            setNotice(sent ? `${m.name} was added. We emailed ${m.email} a link to set their password.` : `${m.name} was added, but the invite email could not be sent. Use Manage → Resend invite.`)
          }}
        />
      )}
      {editing && (
        <ManageStaffModal
          member={editing}
          lastAdmin={editing.role === 'SUPER_ADMIN' && admins <= 1}
          onClose={() => setEditing(null)}
          onChanged={(m) => {
            setStaff((list) => (list ?? []).map((x) => (x.id === m.id ? m : x)))
            setEditing(null)
            setNotice(`${m.name} is now ${roleLabel(m.role)}.`)
          }}
          onRemoved={(m) => {
            setStaff((list) => (list ?? []).filter((x) => x.id !== m.id))
            setEditing(null)
            setNotice(`${m.name} was removed and can no longer sign in.`)
          }}
          onInvited={(m) => {
            setEditing(null)
            setNotice(`A new set-password link went to ${m.email}.`)
          }}
        />
      )}
    </>
  )
}

function RolePicker({ value, onChange }: { value: StaffRole; onChange: (r: StaffRole) => void }) {
  return (
    <div role="radiogroup" aria-label="Role" style={{ display: 'grid', gap: 8 }}>
      {ROLES.map((r) => {
        const on = value === r.role
        return (
          <button
            key={r.role}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(r.role)}
            style={{
              textAlign: 'left',
              padding: '10px 12px',
              borderRadius: 12,
              cursor: 'pointer',
              border: `1.5px solid ${on ? 'var(--gold)' : 'var(--line)'}`,
              background: on ? 'rgba(251, 172, 52, 0.1)' : 'transparent',
              color: 'inherit',
              font: 'inherit',
            }}
          >
            <b style={{ fontSize: 13.5 }}>{r.label}</b>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{r.does}</div>
          </button>
        )
      })}
    </div>
  )
}

function AddStaffModal({ onClose, onAdded }: { onClose: () => void; onAdded: (m: StaffMember, inviteSent: boolean) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<StaffRole>('TASK_MANAGER')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    setBusy(true)
    setError(null)
    api
      .staffAdd({ name: name.trim(), email: email.trim(), role })
      .then((r) => onAdded(r.member, r.inviteSent))
      .catch((e) => setError(errText(e, 'Could not add this person')))
      .finally(() => setBusy(false))
  }

  return (
    <Modal open size="wide" title="Add staff" subtitle="They'll get an email to set their password. Use their work email, not one they use as a Partimer." onClose={onClose}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 1, minWidth: 200 }}>
            <Label htmlFor="add-name">Name</Label>
            <Input id="add-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 200 }}>
            <Label htmlFor="add-email">Work email</Label>
            <Input id="add-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@afrizonemart.com" />
          </div>
        </div>
        <div>
          <Label>Role</Label>
          <div style={{ marginTop: 6 }}>
            <RolePicker value={role} onChange={setRole} />
          </div>
        </div>
        {error && (
          <div className="login-error" role="alert" style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--danger-ink)', fontSize: 13 }}>
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="glass" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="send" loading={busy} disabled={!name.trim() || !email.trim()} onClick={submit}>
            Add and send invite
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function ManageStaffModal({
  member,
  lastAdmin,
  onClose,
  onChanged,
  onRemoved,
  onInvited,
}: {
  member: StaffMember
  lastAdmin: boolean
  onClose: () => void
  onChanged: (m: StaffMember) => void
  onRemoved: (m: StaffMember) => void
  onInvited: (m: StaffMember) => void
}) {
  const [role, setRole] = useState<StaffRole>(member.role)
  const [busy, setBusy] = useState<'role' | 'invite' | 'remove' | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = (kind: 'role' | 'invite' | 'remove', p: Promise<void>) => {
    setBusy(kind)
    setError(null)
    p.catch((e) => setError(errText(e, 'That did not work'))).finally(() => setBusy(null))
  }

  return (
    <Modal open size="wide" title={member.name} subtitle={`${member.email} · added ${formatDate(member.createdAt)}`} onClose={onClose}>
      <div style={{ display: 'grid', gap: 14 }}>
        <div>
          <Label>Role</Label>
          <div style={{ marginTop: 6 }}>
            <RolePicker value={role} onChange={setRole} />
          </div>
          {lastAdmin && role !== 'SUPER_ADMIN' && (
            <div style={{ fontSize: 12, color: 'var(--danger-ink)', marginTop: 6 }}>Part Time needs at least one admin. Make someone else an admin first.</div>
          )}
        </div>

        {error && (
          <div role="alert" style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--danger-ink)', fontSize: 13 }}>
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!confirmRemove ? (
              <Button variant="danger" size="sm" disabled={lastAdmin} onClick={() => setConfirmRemove(true)}>
                Remove from staff
              </Button>
            ) : (
              <>
                <Button
                  variant="danger"
                  size="sm"
                  loading={busy === 'remove'}
                  onClick={() => run('remove', api.staffRemove(member.id).then(() => onRemoved(member)))}
                >
                  Yes, remove {member.name.split(' ')[0]}
                </Button>
                <Button variant="glass" size="sm" onClick={() => setConfirmRemove(false)}>
                  Keep
                </Button>
              </>
            )}
            <Button variant="glass" size="sm" icon="send" loading={busy === 'invite'} onClick={() => run('invite', api.staffInvite(member.id).then(() => onInvited(member)))}>
              {member.canSignIn ? 'Send password reset' : 'Resend invite'}
            </Button>
          </div>
          <Button
            variant="primary"
            size="sm"
            loading={busy === 'role'}
            disabled={role === member.role || (lastAdmin && role !== 'SUPER_ADMIN')}
            onClick={() => run('role', api.staffSetRole(member.id, role).then((r) => onChanged(r.member)))}
          >
            Save role
          </Button>
        </div>
        {confirmRemove && <div style={{ fontSize: 12, color: 'var(--muted)' }}>They're signed out of the console straight away and can't sign in again. Their past work and audit history stay.</div>}
      </div>
    </Modal>
  )
}
