/** Attendance, output, access review and alerts: synced, read-only views. */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import PageHeader from '../../components/PageHeader'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import { useApi } from '../../lib/useApi'
import { addDays, ago, hours, hr, hrFile, niceDate, niceTime, productLabel, today } from '../api'
import { ErrorLine, Load, Muted, Section, Table, Tabs, Tag, TypeTag, useAction } from '../ui'
import { DAY_COLOR, Legend } from './Person'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any

function Range({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <Input aria-label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 160 }} />
      <Muted>to</Muted>
      <Input aria-label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 160 }} />
      <Button size="sm" onClick={() => { setFrom(addDays(today(), -6)); setTo(today()) }}>7 days</Button>
      <Button size="sm" onClick={() => { setFrom(addDays(today(), -29)); setTo(today()) }}>30 days</Button>
    </div>
  )
}

export function HrAttendance() {
  const [from, setFrom] = useState(addDays(today(), -13))
  const [to, setTo] = useState(today())
  const r = useApi((signal) => hr<Any>(`/attendance?from=${from}&to=${to}`, { signal }), [from, to])
  const nav = useNavigate()
  const act = useAction()
  return (
    <>
      <PageHeader
        crumb="AZM Staff · Visibility"
        title="Attendance"
        sub="Present means they signed in to a product admin that day. Late is after the workday start plus grace. Absent is a workday with no sign-in and no leave."
        actions={<Button variant="glass" icon="download" loading={act.busy === 'csv'} onClick={() => act.run('csv', () => hrFile(`/attendance.csv?from=${from}&to=${to}`, { download: `attendance-${from}-${to}.csv` }))}>Export CSV</Button>}
      />
      <ErrorLine error={act.error} />
      <Section actions={<Range from={from} to={to} setFrom={setFrom} setTo={setTo} />} title={r.data ? `Workday ${r.data.workday.start}–${r.data.workday.end}, ${r.data.workday.graceMinutes} min grace` : 'Attendance'} pad={false}>
        <Load r={r}>
          {(d) => (
            <div className="tablewrap">
              <table className="dt">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th style={{ textAlign: 'right' }}>Present</th>
                    <th style={{ textAlign: 'right' }}>Late</th>
                    <th style={{ textAlign: 'right' }}>Absent</th>
                    <th style={{ textAlign: 'right' }}>Leave</th>
                    <th style={{ textAlign: 'right' }}>Hours</th>
                    <th>Days</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((p: Any) => (
                    <tr key={p.userId} onClick={() => nav(`/hr/people/${p.userId}`)} style={{ cursor: 'pointer' }}>
                      <td><b>{p.name}</b> <TypeTag t={p.staffType} /></td>
                      <td className="tnum" style={{ textAlign: 'right' }}>{p.summary.present}</td>
                      <td className="tnum" style={{ textAlign: 'right' }}>{p.summary.late || ''}</td>
                      <td className="tnum" style={{ textAlign: 'right', color: p.summary.absent ? 'var(--danger-ink)' : undefined, fontWeight: p.summary.absent ? 700 : undefined }}>{p.summary.absent || ''}</td>
                      <td className="tnum" style={{ textAlign: 'right' }}>{p.summary.leave || ''}</td>
                      <td className="tnum" style={{ textAlign: 'right' }}>{p.summary.hours}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 3 }}>
                          {p.days.map((x: Any) => (
                            <span key={x.date} title={`${niceDate(x.date)}: ${x.state.toLowerCase()}${x.firstSeenAt ? ` · in ${niceTime(x.firstSeenAt)}, ${hours(x.activeSeconds)}` : ''}${x.holiday ? ` · ${x.holiday}` : ''}`} style={{ width: 14, height: 14, borderRadius: 3, background: DAY_COLOR[x.state], border: x.state === 'FUTURE' ? '1px dashed var(--line-2)' : undefined }} />
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: '0 16px 16px' }}><Legend /></div>
            </div>
          )}
        </Load>
      </Section>
    </>
  )
}

export function HrOutput() {
  const [from, setFrom] = useState(addDays(today(), -29))
  const [to, setTo] = useState(today())
  const r = useApi((signal) => hr<Any>(`/output?from=${from}&to=${to}`, { signal }), [from, to])
  const nav = useNavigate()
  return (
    <>
      <PageHeader crumb="AZM Staff · Visibility" title="Output" sub="Tasks and weekly reports from the product admins (staff tasks and KPI). Tasks are set by each product's managers, not HR." />
      <Section actions={<Range from={from} to={to} setFrom={setFrom} setTo={setTo} />} pad={false} title="Work done">
        <Load r={r}>
          {(d) => (
            <Table
              rows={d.rows}
              rowKey={(p: Any) => p.userId}
              onRow={(p: Any) => nav(`/hr/people/${p.userId}`)}
              cols={[
                { label: 'Person', render: (p: Any) => <><b>{p.name}</b> <TypeTag t={p.staffType} /></> },
                { label: 'Done', render: (p: Any) => p.tasks.completed, align: 'right' },
                { label: 'On time', render: (p: Any) => (p.tasks.onTimeRate === null ? '—' : `${p.tasks.onTimeRate}%`), align: 'right' },
                { label: 'Overdue', render: (p: Any) => p.tasks.overdue || '', align: 'right' },
                { label: 'Sent back', render: (p: Any) => p.tasks.reworked || '', align: 'right' },
                { label: 'Open now', render: (p: Any) => p.tasks.open, align: 'right' },
                { label: 'Offsite', render: (p: Any) => (p.tasks.offsiteMinutes ? hours(p.tasks.offsiteMinutes * 60) : ''), align: 'right' },
                { label: 'Weekly reports', render: (p: Any) => (p.weeklyReports.due ? `${p.weeklyReports.submitted}/${p.weeklyReports.due}` : '—'), align: 'right' },
                { label: 'Top activity', render: (p: Any) => <Muted>{Object.entries(p.tasks.activity as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k.split('.').slice(-2).join(' ')} ${v}`).join(' · ') || '—'}</Muted> },
              ]}
            />
          )}
        </Load>
      </Section>
    </>
  )
}

export function HrAccess() {
  const r = useApi((signal) => hr<Any>('/access', { signal }), [])
  const [tab, setTab] = useState<'flagged' | 'all'>('flagged')
  const nav = useNavigate()
  return (
    <>
      <PageHeader crumb="AZM Staff · Visibility" title="Access review" sub="Who can sign in where, synced from every product admin. Only product admins change access; this page shows what to ask them to fix." />
      <Load r={r}>
        {(d) => (
          <>
            <Tabs value={tab} onChange={setTab} tabs={[{ value: 'flagged', label: 'Needs a look', count: d.flagged }, { value: 'all', label: 'Everyone' }]} />
            <Section pad={false}>
              <Table
                rows={tab === 'flagged' ? d.rows.filter((x: Any) => x.flags.length) : d.rows}
                rowKey={(x: Any) => x.userId}
                onRow={(x: Any) => nav(`/hr/people/${x.userId}`)}
                empty="Nothing to fix"
                emptyIcon="shield"
                cols={[
                  { label: 'Person', render: (x: Any) => <div><b>{x.name}</b> {x.owner && <Tag tone="warn">Owner</Tag>}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{x.email}</div></div> },
                  { label: 'Products', render: (x: Any) => (x.owner ? 'Every product' : x.memberships.map((m: Any) => productLabel(m.product) + (m.productAdmin ? ' (admin)' : '') + (m.finance ? ' (finance)' : '')).join(', ') || <Muted>None</Muted>) },
                  { label: '2FA', render: (x: Any) => <Tag tone={x.twoFactor ? 'ok' : 'warn'}>{x.twoFactor ? 'On' : 'Off'}</Tag> },
                  { label: 'Last seen', render: (x: Any) => <Muted>{ago(x.lastSeenAt)}</Muted> },
                  { label: 'To fix', render: (x: Any) => (x.flags.length ? <div style={{ display: 'grid', gap: 4 }}>{x.flags.map((f: Any, i: number) => <span key={i} style={{ fontSize: 12.5 }}><Tag tone={f.level === 'critical' ? 'bad' : 'warn'}>{f.level === 'critical' ? 'Critical' : 'Check'}</Tag> {f.text}</span>)}</div> : <Muted>—</Muted>) },
                ]}
              />
            </Section>
          </>
        )}
      </Load>
    </>
  )
}

export function HrAlerts() {
  const r = useApi((signal) => hr<Any[]>('/alerts', { signal }), [])
  const [level, setLevel] = useState<'all' | 'critical' | 'warn' | 'info'>('all')
  return (
    <>
      <PageHeader crumb="AZM HR Console" title="Alerts" sub="Contracts, probation and internships ending, expiring documents, access that should be off, people not in, and everything waiting for HR." />
      <Load r={r}>
        {(d) => (
          <>
            <Tabs
              value={level}
              onChange={setLevel}
              tabs={[
                { value: 'all', label: 'All', count: d.length },
                { value: 'critical', label: 'Critical', count: d.filter((a) => a.level === 'critical').length },
                { value: 'warn', label: 'To act on', count: d.filter((a) => a.level === 'warn').length },
                { value: 'info', label: 'To know', count: d.filter((a) => a.level === 'info').length },
              ]}
            />
            <Section pad={false}>
              <Table
                rows={d.filter((a) => level === 'all' || a.level === level).map((a, i) => ({ ...a, i }))}
                rowKey={(a: Any) => String(a.i)}
                empty="All clear"
                emptyIcon="check"
                cols={[
                  { label: '', width: 90, render: (a: Any) => <Tag tone={a.level === 'critical' ? 'bad' : a.level === 'warn' ? 'warn' : undefined}>{a.level === 'critical' ? 'Critical' : a.level === 'warn' ? 'Act' : 'Note'}</Tag> },
                  { label: 'Who', render: (a: Any) => (a.userId ? <Link to={`/hr/people/${a.userId}`} style={{ fontWeight: 700 }}>{a.name ?? 'Someone'}</Link> : a.link ? <Link to={`/hr/${a.link}`} style={{ fontWeight: 700 }}>Open</Link> : '—') },
                  { label: 'What', render: (a: Any) => a.text },
                  { label: 'Kind', render: (a: Any) => <Muted>{a.kind.replace(/_/g, ' ')}</Muted> },
                ]}
              />
            </Section>
          </>
        )}
      </Load>
    </>
  )
}
