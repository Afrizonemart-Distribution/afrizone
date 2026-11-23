/** Reports, HR settings (workday, statutory rates, Telegram alerts) and the HR audit log. */
import { useEffect, useState } from 'react'
import PageHeader from '../../components/PageHeader'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import { useApi } from '../../lib/useApi'
import { hr, niceDate, productLabel, typeLabel } from '../api'
import { useHr } from '../HrContext'
import { ErrorLine, Field, FormGrid, Grid, Load, Muted, Section, Stat, Table, Tabs, useAction } from '../ui'
import { BarList, ChartCard, Donut, PersonCell } from '../charts'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any

export function HrReports() {
  const r = useApi((signal) => hr<Any>('/reports', { signal }), [])
  return (
    <>
      <PageHeader crumb="AZM HR Console" title="Reports" sub="Headcount, turnover, absence, leave owed and the intern pipeline. Export the full lists from People and Attendance." />
      <Load r={r}>
        {(d) => (
          <>
            <Grid min={170}>
              <Stat label="Headcount" value={d.headcount} icon="users" />
              <Stat label="Joined, 12 months" value={d.last12Months.joiners} tone="var(--money)" icon="arrow-up" />
              <Stat label="Left, 12 months" value={d.last12Months.leavers} icon="logout" />
              <Stat label="Turnover" value={`${d.last12Months.turnoverPct}%`} hint="leavers ÷ average headcount" />
              <Stat label="Absence, 30 days" value={`${d.last30Days.absenceRatePct}%`} hint={`${d.last30Days.absentDays} days absent · ${d.last30Days.lateArrivals} late`} tone="var(--danger)" icon="alert" />
              <Stat label="Annual leave owed" value={d.leaveOwedDays} hint="days not yet taken this year" icon="calendar" />
            </Grid>
            <div style={{ height: 16 }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))', gap: 16 }}>
              <ChartCard title="By staff type" subtitle="Current headcount"><Donut data={d.byType} label={typeLabel} centerLabel="Staff" description="Current headcount by staff type" /></ChartCard>
              <ChartCard title="By product" subtitle="Where each person has admin access"><BarList data={d.byProduct} label={(k) => (k === 'NONE' ? 'No access' : productLabel(k))} description="Staff by product access" /></ChartCard>
              <ChartCard title="By department"><BarList data={d.byDepartment} color="var(--indigo)" description="Staff by department" /></ChartCard>
              <ChartCard title="Why people left" subtitle="Last 12 months">{Object.keys(d.last12Months.leaversByReason).length ? <BarList data={d.last12Months.leaversByReason} color="var(--gold)" label={(k) => k.replace(/_/g, ' ').toLowerCase()} description="Leavers in the last 12 months by reason" /> : <span style={{ color: 'var(--muted)', fontSize: 13 }}>Nobody left in the last 12 months.</span>}</ChartCard>
            </div>
            <Section title="Intern pipeline" sub="Active interns, soonest ending first. Decide in time: extend, hire, or let it end." pad={false}>
              <Table rows={d.internPipeline} rowKey={(i: Any) => i.userId} empty="No active interns" cols={[{ label: 'Intern', render: (i: Any) => <PersonCell userId={i.userId} name={i.name} /> }, { label: 'Started', render: (i: Any) => niceDate(i.startDate) }, { label: 'Ends', render: (i: Any) => (i.endsAt ? niceDate(i.endsAt) : <Muted>No end date set</Muted>) }]} />
            </Section>
          </>
        )}
      </Load>
    </>
  )
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function HrSettings() {
  const [tab, setTab] = useState<'workday' | 'rates' | 'telegram' | 'audit'>('workday')
  const { can } = useHr()
  return (
    <>
      <PageHeader crumb="AZM HR Console" title="HR settings" sub="The workday that decides late and absent, and the tax and pension rates payroll uses. Changing them needs no deploy." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'workday', label: 'Workday' }, { value: 'rates', label: 'Tax & pension' }, { value: 'telegram', label: 'Telegram alerts' }, ...(can('hr.manage') ? [{ value: 'audit' as const, label: 'Audit log' }] : [])]} />
      {tab === 'workday' && <WorkdaySettings />}
      {tab === 'rates' && <RateSettings />}
      {tab === 'telegram' && <TelegramSettings />}
      {tab === 'audit' && <Audit />}
    </>
  )
}

const EVENTS: { key: string; label: string; help: string }[] = [
  { key: 'leave', label: 'Leave waiting for HR', help: 'After the line manager approves, or straight away if there is none' },
  { key: 'claims', label: 'Expense claims waiting for HR', help: 'Who and what kind; never the amount' },
  { key: 'payroll', label: 'Payroll', help: 'Submitted for approval, approved, sent back, fully paid' },
  { key: 'documents', label: 'Documents signed', help: 'Who signed what kind of document' },
  { key: 'queries', label: 'Query responses', help: 'Who responded; the response stays in the console' },
  { key: 'people', label: 'Leavers', help: 'A reminder to check every product removed their access' },
  { key: 'digest', label: 'Morning digest', help: 'What needs HR today, who is on leave, birthdays' },
]

function TelegramSettings() {
  const r = useApi((signal) => hr<Any>('/settings/notify', { signal }), [])
  const { can } = useHr()
  const act = useAction()
  const [n, setN] = useState<Any | null>(null)
  const [chats, setChats] = useState('')
  const [tested, setTested] = useState<string | null>(null)
  useEffect(() => {
    if (r.data) {
      setN({ events: { ...r.data.events }, digestAt: r.data.digestAt })
      setChats(r.data.chatIds.join(', '))
    }
  }, [r.data])
  const edit = can('hr.manage')
  const chatIds = chats.split(/[\s,]+/).map((c) => c.trim()).filter(Boolean)
  return (
    <Load r={r}>
      {(d) =>
        n && (
          <Section title="Telegram alerts" sub="HR news goes to the HR heads' Telegram chat through the Afrizonemart bot. Messages say who and what happened and link back here. They never include pay, bank details, NIN, leave reasons or what a query says.">
            {!d.botConfigured && <div className="login-error" role="status" style={{ margin: '0 0 14px' }}>The Telegram bot isn't set up on the server yet (TELEGRAM_BOT_TOKEN). Settings save, but nothing is sent.</div>}
            {d.killSwitchOn && <div className="login-error" role="status" style={{ margin: '0 0 14px' }}>HR Telegram alerts are switched off in Feature flags (hr_telegram_alerts).</div>}
            <ErrorLine error={act.error} />
            {tested && <div role="status" style={{ margin: '0 0 14px', fontSize: 13.5, color: 'var(--money)' }}>{tested}</div>}
            <Field label="Chat ids" htmlFor="tg-chats" help="Up to 5, separated by commas. A person's id is digits; a group's starts with a minus sign. Each person, or the group, must press Start on the bot first. Ask the person who looks after the bot for the id.">
              <Input id="tg-chats" value={chats} onChange={(e) => setChats(e.target.value)} disabled={!edit} placeholder="e.g. -1001234567890" />
            </Field>
            <Field label="Send">
              <div style={{ display: 'grid', gap: 10 }}>
                {EVENTS.map((e) => (
                  <label key={e.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13.5 }}>
                    <input type="checkbox" style={{ marginTop: 3 }} disabled={!edit} checked={!!n.events[e.key]} onChange={(ev) => setN({ ...n, events: { ...n.events, [e.key]: ev.target.checked } })} />
                    <span><strong>{e.label}</strong><br /><Muted>{e.help}</Muted></span>
                  </label>
                ))}
              </div>
            </Field>
            <FormGrid>
              <Field label="Morning digest at (Lagos)" htmlFor="tg-at"><Input id="tg-at" type="time" value={n.digestAt} onChange={(e) => setN({ ...n, digestAt: e.target.value })} disabled={!edit || !n.events.digest} /></Field>
            </FormGrid>
            {edit && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Button variant="primary" loading={act.busy === 's'} onClick={() => { setTested(null); void act.run('s', () => hr('/settings/notify', { method: 'PUT', body: { chatIds, events: n.events, digestAt: n.digestAt } }), r.reload) }}>Save</Button>
                <Button loading={act.busy === 't'} disabled={!d.chatIds.length} onClick={() => { setTested(null); void act.run('t', async () => { const res = await hr<Any>('/settings/notify/test', { method: 'POST' }); setTested(`Test sent to ${res.sent} of ${res.of} chat(s).`) }) }}>Send a test</Button>
              </div>
            )}
          </Section>
        )
      }
    </Load>
  )
}

function useSettings() {
  return useApi((signal) => hr<Any>('/settings', { signal }), [])
}

function WorkdaySettings() {
  const r = useSettings()
  const { can } = useHr()
  const act = useAction()
  const [w, setW] = useState<Any | null>(null)
  useEffect(() => { if (r.data) setW({ ...r.data.workday }) }, [r.data])
  return (
    <Load r={r}>
      {() =>
        w && (
          <Section title="Workday" sub="Lagos time. Someone is late if their first sign-in is after the start plus grace; absent if a workday passes with no sign-in, no leave and no holiday.">
            <ErrorLine error={act.error} />
            <Field label="Workdays">
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {DAYS.map((d, i) => (
                  <label key={d} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13.5 }}>
                    <input type="checkbox" disabled={!can('hr.manage')} checked={w.days.includes(i + 1)} onChange={(e) => setW({ ...w, days: e.target.checked ? [...w.days, i + 1].sort() : w.days.filter((x: number) => x !== i + 1) })} />
                    {d}
                  </label>
                ))}
              </div>
            </Field>
            <FormGrid>
              <Field label="Starts" htmlFor="w-s"><Input id="w-s" type="time" value={w.start} onChange={(e) => setW({ ...w, start: e.target.value })} disabled={!can('hr.manage')} /></Field>
              <Field label="Ends" htmlFor="w-e"><Input id="w-e" type="time" value={w.end} onChange={(e) => setW({ ...w, end: e.target.value })} disabled={!can('hr.manage')} /></Field>
              <Field label="Grace (minutes)" htmlFor="w-g"><Input id="w-g" type="number" min={0} value={w.graceMinutes} onChange={(e) => setW({ ...w, graceMinutes: Number(e.target.value) })} disabled={!can('hr.manage')} /></Field>
            </FormGrid>
            {can('hr.manage') && <Button variant="primary" loading={!!act.busy} onClick={() => act.run('s', () => hr('/settings', { method: 'PUT', body: { workday: w } }), r.reload)}>Save workday</Button>}
          </Section>
        )
      }
    </Load>
  )
}

function RateSettings() {
  const r = useSettings()
  const { can } = useHr()
  const act = useAction()
  const [s, setS] = useState<Any | null>(null)
  useEffect(() => {
    if (r.data) setS({ ...r.data.statutory, bands: r.data.statutory.bands.map((b: Any) => ({ upTo: b.upToKobo === null ? '' : String(b.upToKobo / 100), rate: String(b.rate) })), cap: String(r.data.statutory.rentReliefCapKobo / 100) })
  }, [r.data])
  const editable = can('hr.manage') && can('hr.payroll')
  function save() {
    const body = {
      statutory: {
        pensionEmployeePct: Number(s.pensionEmployeePct),
        pensionEmployerPct: Number(s.pensionEmployerPct),
        nhfPct: Number(s.nhfPct),
        rentReliefPct: Number(s.rentReliefPct),
        rentReliefCapKobo: Math.round(Number(s.cap) * 100),
        bands: s.bands.map((b: Any) => ({ upToKobo: b.upTo === '' ? null : Math.round(Number(b.upTo) * 100), rate: Number(b.rate) })),
      },
    }
    act.run('s', () => hr('/settings', { method: 'PUT', body }), r.reload)
  }
  return (
    <Load r={r}>
      {() =>
        s && (
          <Section title="Tax & pension" sub="Defaults follow the Nigeria Tax Act 2025 (from January 2026). Have your accountant confirm them before the first payroll. Changing them needs hr.manage and hr.payroll.">
            <ErrorLine error={act.error} />
            <FormGrid>
              <Field label="Pension, staff %" htmlFor="r-pe"><Input id="r-pe" type="number" step="0.1" value={s.pensionEmployeePct} onChange={(e) => setS({ ...s, pensionEmployeePct: e.target.value })} disabled={!editable} /></Field>
              <Field label="Pension, AZM %" htmlFor="r-pr"><Input id="r-pr" type="number" step="0.1" value={s.pensionEmployerPct} onChange={(e) => setS({ ...s, pensionEmployerPct: e.target.value })} disabled={!editable} /></Field>
              <Field label="NHF % of basic" htmlFor="r-n"><Input id="r-n" type="number" step="0.1" value={s.nhfPct} onChange={(e) => setS({ ...s, nhfPct: e.target.value })} disabled={!editable} /></Field>
              <Field label="Rent relief % of rent" htmlFor="r-rr"><Input id="r-rr" type="number" step="0.1" value={s.rentReliefPct} onChange={(e) => setS({ ...s, rentReliefPct: e.target.value })} disabled={!editable} /></Field>
              <Field label="Rent relief cap (₦ a year)" htmlFor="r-rc"><Input id="r-rc" type="number" value={s.cap} onChange={(e) => setS({ ...s, cap: e.target.value })} disabled={!editable} /></Field>
            </FormGrid>
            <Field label="Income tax bands (annual taxable income)">
              <div style={{ display: 'grid', gap: 6, maxWidth: 520 }}>
                {s.bands.map((b: Any, i: number) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 40px', gap: 8, alignItems: 'center' }}>
                    <Input aria-label="Up to ₦" type="number" value={b.upTo} placeholder="Everything above" onChange={(e) => setS({ ...s, bands: s.bands.map((x: Any, j: number) => (j === i ? { ...x, upTo: e.target.value } : x)) })} disabled={!editable} />
                    <Input aria-label="Rate %" type="number" value={b.rate} onChange={(e) => setS({ ...s, bands: s.bands.map((x: Any, j: number) => (j === i ? { ...x, rate: e.target.value } : x)) })} disabled={!editable} />
                    {editable && <Button size="sm" variant="danger" aria-label="Remove" onClick={() => setS({ ...s, bands: s.bands.filter((_: Any, j: number) => j !== i) })}>×</Button>}
                  </div>
                ))}
                <Muted>Each row taxes income up to that amount (cumulative). Leave the last one empty: it covers everything above.</Muted>
                {editable && <Button size="sm" icon="plus" onClick={() => setS({ ...s, bands: [...s.bands.slice(0, -1), { upTo: '', rate: '0' }, s.bands[s.bands.length - 1]] })}>Add band</Button>}
              </div>
            </Field>
            {editable && <Button variant="primary" loading={!!act.busy} onClick={save}>Save rates</Button>}
          </Section>
        )
      }
    </Load>
  )
}

function Audit() {
  const r = useApi((signal) => hr<Any[]>('/audit', { signal }), [])
  return (
    <Section title="HR audit log" sub="Every change made in HR, newest first. Personal values are never written here, only which fields changed." pad={false}>
      <Load r={r}>
        {(rows) => (
          <Table
            rows={rows}
            rowKey={(a: Any) => a.id}
            empty="No HR changes yet"
            cols={[
              { label: 'When', render: (a: Any) => <span className="tnum">{new Date(a.createdAt).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' })}</span> },
              { label: 'Who', render: (a: Any) => a.actorEmail ?? <Muted>staff member</Muted> },
              { label: 'What', render: (a: Any) => a.action.replace(/^hr\./, '').replace(/[._]/g, ' ') },
              { label: 'Detail', render: (a: Any) => <Muted>{a.changes && Object.keys(a.changes).length ? JSON.stringify(a.changes).slice(0, 140) : '—'}</Muted> },
            ]}
          />
        )}
      </Load>
    </Section>
  )
}
