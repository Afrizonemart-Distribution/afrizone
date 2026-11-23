import { useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../../components/PageHeader'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Modal from '../../components/ui/Modal'
import Switch from '../../components/ui/Switch'
import Textarea from '../../components/ui/Textarea'
import { useApi } from '../../lib/useApi'
import { addDays, hr, niceDate, STAFF_TYPES, today } from '../api'
import { useHr } from '../HrContext'
import { ErrorLine, Field, FormGrid, Load, Muted, Section, Status, Table, Tabs, Tag, useAction } from '../ui'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any

export default function HrLeave() {
  const [tab, setTab] = useState<'queue' | 'calendar' | 'types' | 'holidays'>('queue')
  return (
    <>
      <PageHeader crumb="AZM Staff · HR" title="Leave" sub="Requests go to the line manager (an intern's supervisor) first, then HR. Approved leave also shows in every product admin's KPI, so nobody is scored absent while on leave." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'queue', label: 'Waiting for HR' }, { value: 'calendar', label: "Who's off" }, { value: 'types', label: 'Leave types' }, { value: 'holidays', label: 'Public holidays' }]} />
      {tab === 'queue' && <Queue />}
      {tab === 'calendar' && <OffList />}
      {tab === 'types' && <Types />}
      {tab === 'holidays' && <Holidays />}
    </>
  )
}

function Queue() {
  const [status, setStatus] = useState<'PENDING_HR' | 'PENDING_MANAGER' | ''>('PENDING_HR')
  const r = useApi((signal) => hr<Any[]>(`/leave${status ? `?status=${status}` : ''}`, { signal }), [status])
  const { can } = useHr()
  const act = useAction()
  const [rejecting, setRejecting] = useState<Any | null>(null)
  const [note, setNote] = useState('')
  return (
    <Section pad={false} actions={<Tabs value={status} onChange={setStatus} tabs={[{ value: 'PENDING_HR', label: 'With HR' }, { value: 'PENDING_MANAGER', label: 'With managers' }, { value: '', label: 'All' }]} />}>
      <ErrorLine error={act.error} />
      <Load r={r}>
        {(rows) => (
          <Table
            rows={rows}
            rowKey={(l: Any) => l.id}
            empty="Nothing waiting"
            emptyIcon="calendar"
            cols={[
              { label: 'Person', render: (l: Any) => <Link to={`/hr/people/${l.userId}`} style={{ fontWeight: 700 }}>{l.name}</Link> },
              { label: 'Leave', render: (l: Any) => <div>{l.type}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{l.reason ?? ''}</div></div> },
              { label: 'Dates', render: (l: Any) => <span className="tnum">{niceDate(l.startDate)} → {niceDate(l.endDate)}</span> },
              { label: 'Days', render: (l: Any) => l.days, align: 'right' },
              { label: 'Status', render: (l: Any) => <Status s={l.status} /> },
              { label: 'Manager', render: (l: Any) => <Muted>{l.managerName ? `${l.managerName}${l.managerNote ? `: “${l.managerNote}”` : ''}` : '—'}</Muted> },
              {
                label: '',
                align: 'right',
                render: (l: Any) =>
                  can('hr.manage') && ['PENDING_HR', 'PENDING_MANAGER'].includes(l.status) ? (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Button size="sm" variant="danger" onClick={() => { setRejecting(l); setNote('') }}>Decline</Button>
                      <Button size="sm" variant="money" icon="check" loading={act.busy === l.id} onClick={() => act.run(l.id, () => hr(`/leave/${l.id}/decide`, { method: 'POST', body: { approve: true } }), r.reload)} title={l.status === 'PENDING_MANAGER' ? 'Approves without waiting for the manager' : undefined}>Approve</Button>
                    </div>
                  ) : null,
              },
            ]}
          />
        )}
      </Load>
      <Modal open={!!rejecting} title="Decline leave" subtitle={rejecting ? `${rejecting.name}: ${rejecting.type}, ${rejecting.days} day(s)` : ''} onClose={() => setRejecting(null)}>
        <Field label="Reason (they see this)" htmlFor="lr"><Textarea id="lr" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button onClick={() => setRejecting(null)}>Cancel</Button>
          <Button variant="danger" loading={!!act.busy} onClick={() => act.run('rej', () => hr(`/leave/${rejecting.id}/decide`, { method: 'POST', body: { approve: false, note: note || undefined } }), () => { setRejecting(null); r.reload() })}>Decline</Button>
        </div>
      </Modal>
    </Section>
  )
}

function OffList() {
  const from = today()
  const to = addDays(from, 60)
  const r = useApi((signal) => hr<Any[]>(`/leave?status=APPROVED&from=${from}&to=${to}`, { signal }), [])
  return (
    <Section title="Approved leave, next 60 days" pad={false}>
      <Load r={r}>
        {(rows) => (
          <Table
            rows={[...rows].sort((a, b) => a.startDate.localeCompare(b.startDate))}
            rowKey={(l: Any) => l.id}
            empty="Nobody is off in the next 60 days"
            cols={[
              { label: 'Person', render: (l: Any) => <Link to={`/hr/people/${l.userId}`} style={{ fontWeight: 700 }}>{l.name}</Link> },
              { label: 'Leave', render: (l: Any) => l.type },
              { label: 'From', render: (l: Any) => niceDate(l.startDate) },
              { label: 'To', render: (l: Any) => niceDate(l.endDate) },
              { label: 'Days', render: (l: Any) => l.days, align: 'right' },
            ]}
          />
        )}
      </Load>
    </Section>
  )
}

function Types() {
  const r = useApi((signal) => hr<Any[]>('/leave-types', { signal }), [])
  const { can } = useHr()
  const act = useAction()
  const [edit, setEdit] = useState<Any | null>(null)
  const blank = { code: '', name: '', daysPerYear: 0, paid: true, needsManager: true, staffTypes: [] as string[], active: true, sort: 0 }
  return (
    <Section pad={false} title="Leave types" sub="Days per year are working days. Leave a type's staff types empty to offer it to everyone." actions={can('hr.manage') && <Button variant="primary" icon="plus" onClick={() => setEdit({ ...blank })}>Add type</Button>}>
      <Load r={r}>
        {(rows) => (
          <Table
            rows={rows}
            rowKey={(t: Any) => t.id}
            onRow={can('hr.manage') ? (t: Any) => setEdit({ ...t }) : undefined}
            cols={[
              { label: 'Type', render: (t: Any) => <div><b>{t.name}</b> <Muted>{t.code}</Muted></div> },
              { label: 'Days / year', render: (t: Any) => (t.daysPerYear ? t.daysPerYear : 'Unlimited'), align: 'right' },
              { label: 'Paid', render: (t: Any) => (t.paid ? 'Yes' : 'No') },
              { label: 'Manager step', render: (t: Any) => (t.needsManager ? 'Yes' : 'Straight to HR') },
              { label: 'For', render: (t: Any) => (t.staffTypes.length ? t.staffTypes.map((s: string) => STAFF_TYPES.find((x) => x.value === s)?.label).join(', ') : 'Everyone') },
              { label: '', render: (t: Any) => (t.active ? null : <Tag>Off</Tag>) },
            ]}
          />
        )}
      </Load>
      <Modal open={!!edit} title={edit?.id ? 'Edit leave type' : 'New leave type'} onClose={() => setEdit(null)}>
        {edit && (
          <>
            <FormGrid>
              <Field label="Name" htmlFor="t-n"><Input id="t-n" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Code" htmlFor="t-c"><Input id="t-c" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} placeholder="ANNUAL" /></Field>
              <Field label="Days per year (0 = unlimited)" htmlFor="t-d"><Input id="t-d" type="number" value={edit.daysPerYear} onChange={(e) => setEdit({ ...edit, daysPerYear: Number(e.target.value) })} /></Field>
              <Field label="Order" htmlFor="t-s"><Input id="t-s" type="number" value={edit.sort} onChange={(e) => setEdit({ ...edit, sort: Number(e.target.value) })} /></Field>
            </FormGrid>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', margin: '4px 0 12px' }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13.5 }}><Switch checked={edit.paid} onChange={(v) => setEdit({ ...edit, paid: v })} label="Paid" /> Paid</label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13.5 }}><Switch checked={edit.needsManager} onChange={(v) => setEdit({ ...edit, needsManager: v })} label="Manager approves first" /> Manager approves first</label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13.5 }}><Switch checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Active" /> Active</label>
            </div>
            <Field label="Only for">
              <div style={{ display: 'flex', gap: 14 }}>
                {STAFF_TYPES.map((s) => (
                  <label key={s.value} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13.5 }}>
                    <input type="checkbox" checked={edit.staffTypes.includes(s.value)} onChange={(e) => setEdit({ ...edit, staffTypes: e.target.checked ? [...edit.staffTypes, s.value] : edit.staffTypes.filter((x: string) => x !== s.value) })} />
                    {s.label}
                  </label>
                ))}
              </div>
            </Field>
            <ErrorLine error={act.error} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Button onClick={() => setEdit(null)}>Cancel</Button>
              <Button
                variant="primary"
                loading={!!act.busy}
                onClick={() => {
                  const { id, createdAt: _c, ...body } = edit
                  act.run('s', () => hr(id ? `/leave-types/${id}` : '/leave-types', { method: id ? 'PUT' : 'POST', body }), () => { setEdit(null); r.reload() })
                }}
              >
                Save
              </Button>
            </div>
          </>
        )}
      </Modal>
    </Section>
  )
}

function Holidays() {
  const [year, setYear] = useState(new Date().getFullYear())
  const r = useApi((signal) => hr<Any[]>(`/holidays?year=${year}`, { signal }), [year])
  const { can } = useHr()
  const act = useAction()
  const [edit, setEdit] = useState<Any | null>(null)
  return (
    <Section
      pad={false}
      title={`Public holidays ${year}`}
      sub="Not counted as leave days or absences. Islamic holiday dates are estimates until the Federal Government announces them, so check and correct them here."
      actions={
        <>
          <Button size="sm" onClick={() => setYear(year - 1)}>{year - 1}</Button>
          <Button size="sm" onClick={() => setYear(year + 1)}>{year + 1}</Button>
          {can('hr.manage') && <Button variant="primary" icon="plus" onClick={() => setEdit({ day: `${year}-01-01`, name: '' })}>Add holiday</Button>}
        </>
      }
    >
      <ErrorLine error={act.error} />
      <Load r={r}>
        {(rows) => (
          <Table
            rows={rows}
            rowKey={(h: Any) => h.id}
            empty="No holidays set for this year"
            cols={[
              { label: 'Date', render: (h: Any) => <span className="tnum">{niceDate(h.day)}</span> },
              { label: 'Holiday', render: (h: Any) => <span>{h.name} {/estimated/i.test(h.name) && <Tag tone="warn">confirm date</Tag>}</span> },
              {
                label: '',
                align: 'right',
                render: (h: Any) =>
                  can('hr.manage') ? (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Button size="sm" onClick={() => setEdit({ ...h })}>Edit</Button>
                      <Button size="sm" variant="danger" onClick={() => confirm(`Remove ${h.name}?`) && act.run('d' + h.id, () => hr(`/holidays/${h.id}`, { method: 'DELETE' }), r.reload)}>Remove</Button>
                    </div>
                  ) : null,
              },
            ]}
          />
        )}
      </Load>
      <Modal open={!!edit} title={edit?.id ? 'Edit holiday' : 'Add holiday'} onClose={() => setEdit(null)}>
        {edit && (
          <>
            <Field label="Date" htmlFor="h-d"><Input id="h-d" type="date" value={edit.day} onChange={(e) => setEdit({ ...edit, day: e.target.value })} /></Field>
            <Field label="Name" htmlFor="h-n"><Input id="h-n" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <ErrorLine error={act.error} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Button onClick={() => setEdit(null)}>Cancel</Button>
              <Button variant="primary" loading={!!act.busy} onClick={() => act.run('s', () => hr(edit.id ? `/holidays/${edit.id}` : '/holidays', { method: edit.id ? 'PUT' : 'POST', body: { day: edit.day, name: edit.name } }), () => { setEdit(null); r.reload() })}>Save</Button>
            </div>
          </>
        )}
      </Modal>
    </Section>
  )
}
