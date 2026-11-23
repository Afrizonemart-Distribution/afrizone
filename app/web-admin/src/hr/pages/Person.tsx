import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import PageHeader from '../../components/PageHeader'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Modal from '../../components/ui/Modal'
import Select from '../../components/ui/Select'
import Switch from '../../components/ui/Switch'
import Textarea from '../../components/ui/Textarea'
import { useApi } from '../../lib/useApi'
import { ago, fileToBase64, hours, hr, hrFile, naira, niceDate, niceTime, productLabel, STAFF_TYPES, today, typeLabel } from '../api'
import { useHr } from '../HrContext'
import { ErrorLine, Field, FormGrid, Grid, Load, Muted, Section, Stat, Status, Table, Tabs, Tag, TypeTag, useAction } from '../ui'
import type { DirPerson } from './People'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any

type TabKey = 'overview' | 'file' | 'documents' | 'leave' | 'checklists' | 'more' | 'intern'

export default function HrPerson() {
  const { id = '' } = useParams()
  const r = useApi((signal) => hr<Any>(`/people/${id}`, { signal }), [id])
  const [tab, setTab] = useState<TabKey>('overview')
  const { can } = useHr()
  const [exitOpen, setExitOpen] = useState(false)
  const [queryOpen, setQueryOpen] = useState(false)

  return (
    <Load r={r} label="Opening their file…">
      {(d) => {
        const f = d.file
        const intern = d.staffType === 'INTERN'
        return (
          <>
            <PageHeader
              crumb="AZM Staff · People"
              title={d.user.name ?? 'Unnamed'}
              sub={
                <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <TypeTag t={d.staffType} />
                  {f.status === 'EXITED' && <Status s="EXITED" />}
                  <span>{[d.user.jobTitle, d.user.department].filter(Boolean).join(' · ') || 'No job title yet'}</span>
                  {d.user.managerName && <span>· reports to {d.user.managerName}</span>}
                </span>
              }
              actions={
                can('hr.manage') ? (
                  <>
                    <Button variant="glass" icon="alert" onClick={() => setQueryOpen(true)}>Issue a query</Button>
                    {f.status === 'EXITED' ? (
                      <Button variant="glass" onClick={() => hr(`/people/${id}/exit/undo`, { method: 'POST' }).then(r.reload)}>Undo leaving</Button>
                    ) : (
                      <Button variant="danger" onClick={() => setExitOpen(true)}>Record leaving</Button>
                    )}
                  </>
                ) : null
              }
            />
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'overview', label: 'Overview' },
                { value: 'file', label: 'Employee file' },
                { value: 'documents', label: 'Documents', count: d.documents.length },
                { value: 'leave', label: 'Leave' },
                { value: 'checklists', label: 'Joining & leaving' },
                { value: 'more', label: 'Assets, reviews, queries' },
                ...(intern ? [{ value: 'intern' as const, label: 'Intern work' }] : []),
              ]}
            />
            {tab === 'overview' && <OverviewTab d={d} />}
            {tab === 'file' && <FileTab id={id} file={f} onSaved={r.reload} />}
            {tab === 'documents' && <DocsTab id={id} docs={d.documents} onChange={r.reload} />}
            {tab === 'leave' && <LeaveTab id={id} d={d} onChange={r.reload} />}
            {tab === 'checklists' && <ChecklistTab id={id} d={d} onChange={r.reload} />}
            {tab === 'more' && <MoreTab d={d} />}
            {tab === 'intern' && intern && <InternTab d={d} />}
            <ExitModal id={id} open={exitOpen} onClose={() => setExitOpen(false)} onDone={() => { setExitOpen(false); setTab('checklists'); r.reload() }} intern={intern} />
            <QueryModal id={id} open={queryOpen} onClose={() => setQueryOpen(false)} onDone={() => { setQueryOpen(false); r.reload() }} />
          </>
        )
      }}
    </Load>
  )
}

// ── Overview (synced, read-only) ────────────────────────────────────────────

function OverviewTab({ d }: { d: Any }) {
  const a = d.attendance
  const o = d.output
  const live = d.live
  return (
    <>
      <Grid min={170}>
        <Stat label="Now" value={live ? <Status s={live.state} /> : '—'} hint={live?.workingIn ? `in ${productLabel(live.workingIn)}` : live?.lastSeenAt ? `last seen ${ago(live.lastSeenAt)}` : undefined} />
        <Stat label="First in today" value={live?.firstSeenAt ? niceTime(live.firstSeenAt) : '—'} hint={live?.late ? 'late' : undefined} />
        <Stat label="Present, 30 days" value={a ? `${a.summary.present}` : '—'} hint={a ? `${a.summary.late} late · ${a.summary.absent} absent · ${a.summary.leave} leave` : undefined} />
        <Stat label="Hours, 30 days" value={a ? `${a.summary.hours}h` : '—'} />
        <Stat label="Tasks done, 30 days" value={o?.tasks.completed ?? 0} hint={o?.tasks.onTimeRate !== null && o ? `${o.tasks.onTimeRate}% on time · ${o.tasks.open} open` : undefined} />
        <Stat label="Weekly reports" value={o ? `${o.weeklyReports.submitted}/${o.weeklyReports.due}` : '—'} hint="submitted / due" />
      </Grid>
      <div style={{ height: 16 }} />
      {a && (
        <Section title="Last 30 days" sub="From the online signal. Hover a day for times.">
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {a.days.map((x: Any) => (
              <div key={x.date} title={`${niceDate(x.date)}: ${x.state.toLowerCase()}${x.firstSeenAt ? ` · in ${niceTime(x.firstSeenAt)}, ${hours(x.activeSeconds)}` : ''}${x.holiday ? ` · ${x.holiday}` : ''}`} style={{ width: 22, height: 22, borderRadius: 5, background: DAY_COLOR[x.state] ?? 'var(--track)' }} />
            ))}
          </div>
          <Legend />
        </Section>
      )}
      <Section title="Access in the product admins" sub="Managed by each product admin. HR sees it here; it can't be changed from here.">
        {d.access ? (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <Tag tone={d.access.twoFactor ? 'ok' : 'warn'}>{d.access.twoFactor ? '2FA on' : '2FA off'}</Tag>
              <Tag>{d.access.hasAccess ? 'Can sign in' : 'No access'}</Tag>
              {d.access.owner && <Tag tone="warn">Owner: every product</Tag>}
            </div>
            {d.access.flags.map((fl: Any, i: number) => (
              <div key={i} style={{ fontSize: 13.5, marginBottom: 6 }}>
                <Tag tone={fl.level === 'critical' ? 'bad' : 'warn'}>{fl.level === 'critical' ? 'Critical' : 'Check'}</Tag> {fl.text}
              </div>
            ))}
            <Table
              rows={d.access.memberships}
              rowKey={(m: Any) => m.product}
              empty="No product memberships"
              cols={[
                { label: 'Product', render: (m: Any) => <b>{productLabel(m.product)}</b> },
                { label: 'Seat', render: (m: Any) => (m.productAdmin ? 'Product Admin' : 'Member') + (m.finance ? ' · finance' : '') },
                { label: 'Permissions', render: (m: Any) => <Muted>{m.productAdmin ? 'Everything in this product' : m.permissions.join(', ') || 'none'}</Muted> },
                { label: 'Until', render: (m: Any) => niceDate(m.endsAt) },
              ]}
            />
          </>
        ) : (
          <Muted>No access data.</Muted>
        )}
      </Section>
      {d.approver && <Muted>Leave and claims go to {d.approver.name} first, then HR.</Muted>}
    </>
  )
}

export const DAY_COLOR: Record<string, string> = {
  PRESENT: 'var(--money)',
  LATE: 'var(--gold)',
  ABSENT: 'var(--danger)',
  LEAVE: 'var(--indigo)',
  HOLIDAY: 'var(--forest)',
  OFF: 'var(--track)',
  FUTURE: 'transparent',
  BEFORE_START: 'transparent',
}

export function Legend() {
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
      {[['PRESENT', 'Present'], ['LATE', 'Late'], ['ABSENT', 'Absent'], ['LEAVE', 'Leave'], ['HOLIDAY', 'Holiday'], ['OFF', 'Day off']].map(([k, l]) => (
        <span key={k} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: DAY_COLOR[k] }} />
          {l}
        </span>
      ))}
    </div>
  )
}

// ── Employee file ───────────────────────────────────────────────────────────

function FileTab({ id, file, onSaved }: { id: string; file: Any; onSaved: () => void }) {
  const { can } = useHr()
  const edit = can('hr.manage')
  const sens = can('hr.sensitive')
  const payOk = can('hr.payroll') || sens
  const people = useApi((signal) => hr<DirPerson[]>('/directory', { signal }), [])
  const [v, setV] = useState<Any>({})
  const [s, setS] = useState<Any>({})
  const [pay, setPay] = useState<Any>({})
  const act = useAction()
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setV({
      employeeNo: file.employeeNo ?? '',
      staffType: file.staffType,
      jobTitle: file.jobTitle ?? '',
      department: file.department ?? '',
      managerId: file.managerId ?? '',
      supervisorId: file.supervisorId ?? '',
      grade: file.grade ?? '',
      workLocation: file.workLocation ?? '',
      startDate: file.startDate ?? '',
      probationEndsAt: file.probationEndsAt ?? '',
      contractEndsAt: file.contractEndsAt ?? '',
      internshipEndsAt: file.internshipEndsAt ?? '',
      dateOfBirth: sens ? file.dateOfBirth ?? '' : '',
      phone: file.phone ?? '',
      personalEmail: file.personalEmail ?? '',
    })
    setS(sens ? { ...file.sensitive, nextOfKin: { ...file.sensitive?.nextOfKin }, emergency: { ...file.sensitive?.emergency } } : {})
    setPay(payOk && file.pay && typeof file.pay === 'object' ? { ...file.pay, gross: file.pay.grossMonthlyKobo / 100, rent: (file.pay.annualRentKobo ?? 0) / 100 } : { basicPct: 50, housingPct: 25, transportPct: 15, pension: file.staffType !== 'INTERN', nhf: file.staffType !== 'INTERN', paye: true })
  }, [file, sens, payOk])

  const set = (k: string) => (e: { target: { value: string } }) => setV((x: Any) => ({ ...x, [k]: e.target.value }))
  const setSens = (k: string) => (e: { target: { value: string } }) => setS((x: Any) => ({ ...x, [k]: e.target.value }))
  const setPerson = (who: 'nextOfKin' | 'emergency', k: string) => (e: { target: { value: string } }) => setS((x: Any) => ({ ...x, [who]: { ...x[who], [k]: e.target.value } }))
  const nul = (x: string) => (x === '' ? null : x)
  const staffOpts = [{ value: '', label: 'Nobody' }, ...(people.data ?? []).filter((p) => p.userId !== id).map((p) => ({ value: p.userId, label: p.name ?? p.email ?? p.userId }))]

  function save() {
    const body: Any = {
      employeeNo: nul(v.employeeNo), staffType: v.staffType, jobTitle: nul(v.jobTitle), department: nul(v.department), managerId: nul(v.managerId), supervisorId: nul(v.supervisorId),
      grade: nul(v.grade), workLocation: nul(v.workLocation), startDate: nul(v.startDate), probationEndsAt: nul(v.probationEndsAt), contractEndsAt: nul(v.contractEndsAt), internshipEndsAt: nul(v.internshipEndsAt),
      phone: nul(v.phone), personalEmail: nul(v.personalEmail),
    }
    if (sens) {
      body.dateOfBirth = nul(v.dateOfBirth)
      const clean: Any = {}
      for (const k of ['address', 'nin', 'bankName', 'bankCode', 'accountNumber', 'accountName', 'pensionPfa', 'rsaPin', 'taxId']) if (s[k]) clean[k] = s[k]
      for (const k of ['nextOfKin', 'emergency']) if (s[k] && Object.values(s[k]).some(Boolean)) clean[k] = s[k]
      body.sensitive = clean
    }
    if (payOk && pay.gross) {
      body.pay = { grossMonthlyKobo: Math.round(Number(pay.gross) * 100), basicPct: Number(pay.basicPct), housingPct: Number(pay.housingPct), transportPct: Number(pay.transportPct), annualRentKobo: Math.round(Number(pay.rent || 0) * 100), pension: !!pay.pension, nhf: !!pay.nhf, paye: !!pay.paye }
    }
    setSaved(false)
    act.run('save', () => hr(`/people/${id}/file`, { method: 'PUT', body }), () => { setSaved(true); onSaved() })
  }

  const ro = !edit
  return (
    <>
      <ErrorLine error={act.error} />
      <Section title="Job" sub={file.hasFile ? `Last changed ${niceDate(file.updatedAt)}` : 'No HR file yet. Saving creates it and opens their joining checklist.'}>
        <FormGrid>
          <Field label="Employee number" htmlFor="f-no"><Input id="f-no" value={v.employeeNo ?? ''} onChange={set('employeeNo')} disabled={ro} /></Field>
          <Field label="Staff type"><Select value={v.staffType ?? 'FULL_TIME'} onChange={(x) => setV((y: Any) => ({ ...y, staffType: x }))} options={STAFF_TYPES} disabled={ro} /></Field>
          <Field label="Job title" htmlFor="f-jt"><Input id="f-jt" value={v.jobTitle ?? ''} onChange={set('jobTitle')} disabled={ro} /></Field>
          <Field label="Department" htmlFor="f-dep"><Input id="f-dep" value={v.department ?? ''} onChange={set('department')} disabled={ro} /></Field>
          <Field label="Reports to (line manager)"><Select value={v.managerId ?? ''} onChange={(x) => setV((y: Any) => ({ ...y, managerId: x }))} options={staffOpts} disabled={ro} /></Field>
          {v.staffType === 'INTERN' && <Field label="Supervisor" help="Approves an intern's leave and claims."><Select value={v.supervisorId ?? ''} onChange={(x) => setV((y: Any) => ({ ...y, supervisorId: x }))} options={staffOpts} disabled={ro} /></Field>}
          <Field label="Grade" htmlFor="f-gr"><Input id="f-gr" value={v.grade ?? ''} onChange={set('grade')} disabled={ro} /></Field>
          <Field label="Work location" htmlFor="f-loc"><Input id="f-loc" value={v.workLocation ?? ''} onChange={set('workLocation')} placeholder="e.g. Lagos office, remote" disabled={ro} /></Field>
          <Field label="Start date" htmlFor="f-sd"><Input id="f-sd" type="date" value={v.startDate ?? ''} onChange={set('startDate')} disabled={ro} /></Field>
          <Field label="Probation ends" htmlFor="f-pe"><Input id="f-pe" type="date" value={v.probationEndsAt ?? ''} onChange={set('probationEndsAt')} disabled={ro} /></Field>
          {v.staffType === 'CONTRACT' && <Field label="Contract ends" htmlFor="f-ce"><Input id="f-ce" type="date" value={v.contractEndsAt ?? ''} onChange={set('contractEndsAt')} disabled={ro} /></Field>}
          {v.staffType === 'INTERN' && <Field label="Internship ends" htmlFor="f-ie"><Input id="f-ie" type="date" value={v.internshipEndsAt ?? ''} onChange={set('internshipEndsAt')} disabled={ro} /></Field>}
        </FormGrid>
      </Section>
      <Section title="Contact">
        <FormGrid>
          <Field label="Phone" htmlFor="f-ph"><Input id="f-ph" value={v.phone ?? ''} onChange={set('phone')} disabled={ro} /></Field>
          <Field label="Personal email" htmlFor="f-pe2"><Input id="f-pe2" type="email" value={v.personalEmail ?? ''} onChange={set('personalEmail')} disabled={ro} /></Field>
          <Field label="Date of birth" htmlFor="f-dob" help={sens ? undefined : 'Year hidden: needs hr.sensitive'}>{sens ? <Input id="f-dob" type="date" value={v.dateOfBirth ?? ''} onChange={set('dateOfBirth')} disabled={ro} /> : <Input id="f-dob" value={file.dateOfBirth ?? ''} disabled />}</Field>
        </FormGrid>
      </Section>
      <Section title="Personal data" sub={sens ? 'Encrypted at rest. Only people with hr.sensitive see it.' : 'You can see whether these are on file, not their values (needs hr.sensitive).'}>
        {sens ? (
          <FormGrid>
            <Field label="Home address" htmlFor="s-ad" span><Input id="s-ad" value={s.address ?? ''} onChange={setSens('address')} disabled={ro} /></Field>
            <Field label="NIN" htmlFor="s-nin"><Input id="s-nin" inputMode="numeric" value={s.nin ?? ''} onChange={setSens('nin')} disabled={ro} /></Field>
            <Field label="Tax ID" htmlFor="s-tin"><Input id="s-tin" value={s.taxId ?? ''} onChange={setSens('taxId')} disabled={ro} /></Field>
            <Field label="Bank" htmlFor="s-bn"><Input id="s-bn" value={s.bankName ?? ''} onChange={setSens('bankName')} disabled={ro} /></Field>
            <Field label="Bank code" htmlFor="s-bc"><Input id="s-bc" value={s.bankCode ?? ''} onChange={setSens('bankCode')} disabled={ro} /></Field>
            <Field label="Account number" htmlFor="s-an"><Input id="s-an" inputMode="numeric" value={s.accountNumber ?? ''} onChange={setSens('accountNumber')} disabled={ro} /></Field>
            <Field label="Account name" htmlFor="s-anm"><Input id="s-anm" value={s.accountName ?? ''} onChange={setSens('accountName')} disabled={ro} /></Field>
            <Field label="Pension administrator (PFA)" htmlFor="s-pfa"><Input id="s-pfa" value={s.pensionPfa ?? ''} onChange={setSens('pensionPfa')} disabled={ro} /></Field>
            <Field label="RSA PIN" htmlFor="s-rsa"><Input id="s-rsa" value={s.rsaPin ?? ''} onChange={setSens('rsaPin')} disabled={ro} /></Field>
            <Field label="Next of kin: name" htmlFor="k-n"><Input id="k-n" value={s.nextOfKin?.name ?? ''} onChange={setPerson('nextOfKin', 'name')} disabled={ro} /></Field>
            <Field label="Relationship" htmlFor="k-r"><Input id="k-r" value={s.nextOfKin?.relationship ?? ''} onChange={setPerson('nextOfKin', 'relationship')} disabled={ro} /></Field>
            <Field label="Phone" htmlFor="k-p"><Input id="k-p" value={s.nextOfKin?.phone ?? ''} onChange={setPerson('nextOfKin', 'phone')} disabled={ro} /></Field>
            <Field label="Emergency contact: name" htmlFor="e-n"><Input id="e-n" value={s.emergency?.name ?? ''} onChange={setPerson('emergency', 'name')} disabled={ro} /></Field>
            <Field label="Relationship" htmlFor="e-r"><Input id="e-r" value={s.emergency?.relationship ?? ''} onChange={setPerson('emergency', 'relationship')} disabled={ro} /></Field>
            <Field label="Phone" htmlFor="e-p"><Input id="e-p" value={s.emergency?.phone ?? ''} onChange={setPerson('emergency', 'phone')} disabled={ro} /></Field>
          </FormGrid>
        ) : (
          <Grid min={200}>
            {Object.entries(file.sensitive ?? {}).map(([k, val]) => (
              <div key={k} style={{ fontSize: 13.5 }}>
                <Muted>{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</Muted>
                <div>{(val as string) ?? '—'}</div>
              </div>
            ))}
          </Grid>
        )}
      </Section>
      <Section title="Pay" sub={payOk ? 'Used by payroll. Paid by manual bank transfer only.' : 'Needs hr.payroll or hr.sensitive.'}>
        {payOk ? (
          <FormGrid>
            <Field label="Gross monthly pay (₦)" htmlFor="p-g"><Input id="p-g" type="number" min={0} value={pay.gross ?? ''} onChange={(e) => setPay((x: Any) => ({ ...x, gross: e.target.value }))} disabled={ro && !can('hr.payroll')} /></Field>
            <Field label="Basic %" htmlFor="p-b"><Input id="p-b" type="number" value={pay.basicPct ?? 50} onChange={(e) => setPay((x: Any) => ({ ...x, basicPct: e.target.value }))} /></Field>
            <Field label="Housing %" htmlFor="p-h"><Input id="p-h" type="number" value={pay.housingPct ?? 25} onChange={(e) => setPay((x: Any) => ({ ...x, housingPct: e.target.value }))} /></Field>
            <Field label="Transport %" htmlFor="p-t" help="What's left of 100% is other allowances."><Input id="p-t" type="number" value={pay.transportPct ?? 15} onChange={(e) => setPay((x: Any) => ({ ...x, transportPct: e.target.value }))} /></Field>
            <Field label="Annual rent (₦)" htmlFor="p-r" help="For rent relief: 20% of rent, up to ₦500,000."><Input id="p-r" type="number" min={0} value={pay.rent ?? 0} onChange={(e) => setPay((x: Any) => ({ ...x, rent: e.target.value }))} /></Field>
            <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', gridColumn: '1 / -1' }}>
              {(['pension', 'nhf', 'paye'] as const).map((k) => (
                <label key={k} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13.5 }}>
                  <Switch checked={!!pay[k]} onChange={(c) => setPay((x: Any) => ({ ...x, [k]: c }))} label={k} />
                  {k === 'pension' ? 'Pension' : k === 'nhf' ? 'NHF' : 'PAYE'}
                </label>
              ))}
            </div>
          </FormGrid>
        ) : (
          <Muted>{file.pay ? 'Pay is on file.' : 'No pay on file.'}</Muted>
        )}
      </Section>
      {(edit || can('hr.payroll')) && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Button variant="primary" icon="check" loading={act.busy === 'save'} onClick={save}>Save file</Button>
          {saved && <Muted>Saved.</Muted>}
        </div>
      )}
    </>
  )
}

// ── Documents ───────────────────────────────────────────────────────────────

const DOC_KINDS = [
  { value: 'OFFER_LETTER', label: 'Offer letter' },
  { value: 'CONTRACT', label: 'Contract / internship agreement' },
  { value: 'ID', label: 'ID document' },
  { value: 'CERTIFICATE', label: 'Certificate' },
  { value: 'NDA', label: 'NDA' },
  { value: 'WARNING', label: 'Warning letter' },
  { value: 'RECEIPT', label: 'Receipt' },
  { value: 'CV', label: 'CV' },
  { value: 'OTHER', label: 'Other' },
]

function DocsTab({ id, docs, onChange }: { id: string; docs: Any[]; onChange: () => void }) {
  const { can } = useHr()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState('CONTRACT')
  const [title, setTitle] = useState('')
  const [expires, setExpires] = useState('')
  const [sign, setSign] = useState(false)
  const [visible, setVisible] = useState(true)
  const [file, setFile] = useState<File | null>(null)
  const act = useAction()

  async function upload() {
    if (!file) return
    await act.run('up', async () => {
      const dataBase64 = await fileToBase64(file)
      await hr(`/people/${id}/documents`, { method: 'POST', body: { kind, title: title || file.name, contentType: file.type, dataBase64, expiresAt: expires || null, requiresSignature: sign, visibleToStaff: visible } })
    }, () => { setOpen(false); setFile(null); setTitle(''); onChange() })
  }

  return (
    <Section title="Documents" sub="Stored privately at Afrizonemart. Staff see the ones marked visible in My HR, and sign there." actions={can('hr.manage') && <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>Add document</Button>} pad={false}>
      <ErrorLine error={act.error} />
      <Table
        rows={docs}
        rowKey={(d: Any) => d.id}
        empty="No documents yet"
        emptyIcon="file"
        cols={[
          { label: 'Document', render: (d: Any) => <div><b>{d.title}</b><div style={{ fontSize: 12, color: 'var(--muted)' }}>{DOC_KINDS.find((k) => k.value === d.kind)?.label ?? d.kind} · {Math.round(d.sizeBytes / 1024)} KB · {niceDate(d.createdAt)}</div></div> },
          { label: 'Expires', render: (d: Any) => (d.expiresAt ? <span className="tnum">{niceDate(d.expiresAt)}</span> : <Muted>—</Muted>) },
          { label: 'Signature', render: (d: Any) => (!d.requiresSignature ? <Muted>Not needed</Muted> : d.signedAt ? <Tag tone="ok">Signed by {d.signedName} · {niceDate(d.signedAt)}</Tag> : <Tag tone="warn">Waiting</Tag>) },
          { label: 'Staff can see', render: (d: Any) => (d.visibleToStaff ? 'Yes' : 'HR only') },
          {
            label: '',
            align: 'right',
            render: (d: Any) => (
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <Button size="sm" variant="glass" icon="eye" onClick={() => act.run('o' + d.id, () => hrFile(`/documents/${d.id}/file`))}>Open</Button>
                {can('hr.manage') && <Button size="sm" variant="danger" onClick={() => confirm(`Remove “${d.title}”?`) && act.run('d' + d.id, () => hr(`/documents/${d.id}`, { method: 'DELETE' }), onChange)}>Remove</Button>}
              </div>
            ),
          },
        ]}
      />
      <Modal open={open} title="Add a document" subtitle="PDF, JPG, PNG, WEBP or DOCX, up to 6 MB." onClose={() => setOpen(false)}>
        <Field label="Kind"><Select value={kind} onChange={setKind} options={DOC_KINDS} /></Field>
        <Field label="Title" htmlFor="d-t"><Input id="d-t" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Employment contract 2026" /></Field>
        <Field label="File" htmlFor="d-f"><input id="d-f" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        <Field label="Expires (optional)" htmlFor="d-e" help="ID cards, certificates, work permits. HR is alerted 30 days before."><Input id="d-e" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></Field>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5 }}><Switch checked={sign} onChange={setSign} label="Needs their signature" /> Needs their signature (they sign in My HR)</label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5 }}><Switch checked={visible} onChange={setVisible} label="They can see it" /> They can see it in My HR</label>
        <ErrorLine error={act.error} />
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" loading={act.busy === 'up'} disabled={!file} onClick={upload}>Upload</Button>
        </div>
      </Modal>
    </Section>
  )
}

// ── Leave ───────────────────────────────────────────────────────────────────

function LeaveTab({ id, d, onChange }: { id: string; d: Any; onChange: () => void }) {
  const { can } = useHr()
  const [rec, setRec] = useState(false)
  const [adj, setAdj] = useState(false)
  const [typeId, setTypeId] = useState('')
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [reason, setReason] = useState('')
  const [days, setDays] = useState('1')
  const [note, setNote] = useState('')
  const act = useAction()
  const typeOpts = d.balances.map((b: Any) => ({ value: b.typeId, label: b.name }))

  return (
    <>
      <ErrorLine error={act.error} />
      <Section title={`Balances · ${new Date().getFullYear()}`} sub="Working days. Starters get this year's remaining share." actions={can('hr.manage') && <><Button variant="glass" onClick={() => { setTypeId(typeOpts[0]?.value ?? ''); setAdj(true) }}>Adjust balance</Button><Button variant="primary" icon="plus" onClick={() => { setTypeId(typeOpts[0]?.value ?? ''); setRec(true) }}>Record leave</Button></>}>
        <Grid min={170}>
          {d.balances.map((b: Any) => (
            <div key={b.typeId} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12 }}>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 600 }}>{b.name}{!b.paid && ' (unpaid)'}</div>
              <div className="tnum" style={{ fontSize: 22, fontWeight: 800 }}>{b.limited ? b.available : '∞'}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{b.limited ? `of ${b.allowance + b.adjusted} · ${b.used} used${b.pending ? ` · ${b.pending} waiting` : ''}` : `${b.used} used`}</div>
            </div>
          ))}
        </Grid>
      </Section>
      <Section title="Requests" pad={false}>
        <Table
          rows={d.leaveRequests}
          rowKey={(l: Any) => l.id}
          empty="No leave yet"
          emptyIcon="calendar"
          cols={[
            { label: 'Leave', render: (l: Any) => <div><b>{l.type}</b><div style={{ fontSize: 12, color: 'var(--muted)' }}>{l.reason ?? ''}</div></div> },
            { label: 'Dates', render: (l: Any) => <span className="tnum">{niceDate(l.startDate)} → {niceDate(l.endDate)}</span> },
            { label: 'Days', render: (l: Any) => <span className="tnum">{l.days}</span>, align: 'right' },
            { label: 'Status', render: (l: Any) => <Status s={l.status} /> },
            { label: 'By', render: (l: Any) => <Muted>{l.recordedByHr ? `Recorded by ${l.hrName}` : [l.managerName && `Manager: ${l.managerName}`, l.hrName && `HR: ${l.hrName}`].filter(Boolean).join(' · ') || '—'}</Muted> },
            { label: '', align: 'right', render: (l: Any) => (can('hr.manage') && ['APPROVED', 'PENDING_HR', 'PENDING_MANAGER'].includes(l.status) ? <Button size="sm" variant="glass" onClick={() => act.run('c' + l.id, () => hr(`/leave/${l.id}/cancel`, { method: 'POST' }), onChange)}>Cancel</Button> : null) },
          ]}
        />
      </Section>
      <Modal open={rec} title="Record leave" subtitle="For leave agreed outside the app (phoned in sick, paper form). Approved straight away." onClose={() => setRec(false)}>
        <Field label="Type"><Select value={typeId} onChange={setTypeId} options={typeOpts} /></Field>
        <FormGrid>
          <Field label="From" htmlFor="l-f"><Input id="l-f" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To" htmlFor="l-t"><Input id="l-t" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </FormGrid>
        <Field label="Note" htmlFor="l-r"><Textarea id="l-r" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button onClick={() => setRec(false)}>Cancel</Button>
          <Button variant="primary" loading={act.busy === 'rec'} onClick={() => act.run('rec', () => hr(`/people/${id}/leave`, { method: 'POST', body: { typeId, startDate: from, endDate: to, reason: reason || undefined } }), () => { setRec(false); onChange() })}>Record</Button>
        </div>
      </Modal>
      <Modal open={adj} title="Adjust a balance" subtitle="Carry-over, extra days, corrections. Use a minus number to take days off." onClose={() => setAdj(false)}>
        <Field label="Type"><Select value={typeId} onChange={setTypeId} options={typeOpts} /></Field>
        <Field label="Days (+/-)" htmlFor="a-d"><Input id="a-d" type="number" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        <Field label="Why" htmlFor="a-n"><Input id="a-n" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 3 days carried over from 2025" /></Field>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button onClick={() => setAdj(false)}>Cancel</Button>
          <Button variant="primary" loading={act.busy === 'adj'} disabled={note.trim().length < 3} onClick={() => act.run('adj', () => hr(`/people/${id}/leave/adjust`, { method: 'POST', body: { typeId, year: new Date().getFullYear(), days: Number(days), note } }), () => { setAdj(false); onChange() })}>Save</Button>
        </div>
      </Modal>
    </>
  )
}

// ── Checklists ──────────────────────────────────────────────────────────────

function ChecklistTab({ id, d, onChange }: { id: string; d: Any; onChange: () => void }) {
  const { can } = useHr()
  const act = useAction()
  const block = (kind: 'joining' | 'leaving', c: Any) => (
    <Section
      title={kind === 'joining' ? 'Joining' : 'Leaving'}
      sub={c ? `${c.done} of ${c.total} done${c.completedAt ? ` · completed ${niceDate(c.completedAt)}` : ''}` : 'Not started'}
      actions={!c && can('hr.manage') ? <Button variant="glass" icon="plus" onClick={() => act.run(kind, () => hr(`/people/${id}/checklists/${kind}`, { method: 'POST' }), onChange)}>Start checklist</Button> : null}
    >
      {c && (
        <>
          {kind === 'leaving' && c.facts && c.facts.stillHasAccessIn.length > 0 && (
            <div className="login-error" role="alert" style={{ marginBottom: 12 }}>
              Still has access in: {c.facts.stillHasAccessIn.map(productLabel).join(', ')}. Ask each product admin to remove it.
            </div>
          )}
          <div style={{ display: 'grid', gap: 8 }}>
            {c.items.map((i: Any) => (
              <label key={i.key} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14 }}>
                <input type="checkbox" checked={i.done} disabled={i.auto || !can('hr.manage') || act.busy === i.key} onChange={(e) => act.run(i.key, () => hr(`/people/${id}/checklists/${kind}/${i.key}`, { method: 'POST', body: { done: e.target.checked } }), onChange)} style={{ width: 18, height: 18 }} />
                <span style={{ textDecoration: i.done ? 'line-through' : undefined, color: i.done ? 'var(--muted)' : undefined }}>{i.label}</span>
                {i.auto && <Tag>automatic</Tag>}
                {i.doneByName && <Muted>· {i.doneByName}, {niceDate(i.doneAt)}</Muted>}
              </label>
            ))}
          </div>
        </>
      )}
    </Section>
  )
  return (
    <>
      <ErrorLine error={act.error} />
      {block('joining', d.checklists.joining)}
      {block('leaving', d.checklists.leaving)}
      <Muted>Automatic items tick themselves from what the product admins record (accounts, 2FA, access removed) and from HR data (assets, claims, policies).</Muted>
    </>
  )
}

// ── Assets, reviews, queries, training, claims ──────────────────────────────

function MoreTab({ d }: { d: Any }) {
  return (
    <>
      <Section title="Assets they hold" pad={false} actions={<Link to="/hr/assets" className="btn btn-glass btn-sm">All assets</Link>}>
        <Table rows={d.assets} rowKey={(a: Any) => a.id} empty="Holds no company assets" cols={[{ label: 'Tag', render: (a: Any) => <b>{a.tag}</b> }, { label: 'Item', render: (a: Any) => a.description }, { label: 'Since', render: (a: Any) => niceDate(a.assignedAt) }]} />
      </Section>
      <Section title="Performance reviews" pad={false} actions={<Link to="/hr/reviews" className="btn btn-glass btn-sm">Reviews</Link>}>
        <Table rows={d.reviews} rowKey={(r: Any) => r.id} empty="No reviews yet" cols={[{ label: 'Cycle', render: (r: Any) => <b>{r.cycleName}</b> }, { label: 'Reviewer', render: (r: Any) => r.reviewerName ?? '—' }, { label: 'Status', render: (r: Any) => <Status s={r.status} /> }, { label: 'Rating', render: (r: Any) => (r.managerRating ? `${r.managerRating} / 5` : '—') }]} />
      </Section>
      <Section title="Queries" pad={false} actions={<Link to="/hr/queries" className="btn btn-glass btn-sm">All queries</Link>}>
        <Table rows={d.queries} rowKey={(q: Any) => q.id} empty="No queries on record" cols={[{ label: 'Subject', render: (q: Any) => <b>{q.subject}</b> }, { label: 'Issued', render: (q: Any) => niceDate(q.createdAt) }, { label: 'Response', render: (q: Any) => (q.respondedAt ? 'In' : q.overdue ? <Tag tone="bad">Overdue</Tag> : <Muted>Due {niceDate(q.responseDueAt)}</Muted>) }, { label: 'Outcome', render: (q: Any) => (q.closedAt ? q.outcome.replace(/_/g, ' ').toLowerCase() : <Muted>Open</Muted>) }]} />
      </Section>
      <Section title="Training" pad={false} actions={<Link to="/hr/training" className="btn btn-glass btn-sm">Training</Link>}>
        <Table rows={d.training} rowKey={(t: Any) => t.id} empty="No training on record" cols={[{ label: 'Course', render: (t: Any) => <b>{t.title}</b> }, { label: 'Status', render: (t: Any) => <Status s={t.status} /> }, { label: 'Due / done', render: (t: Any) => niceDate(t.completedAt ?? t.dueAt) }, { label: 'Expires', render: (t: Any) => niceDate(t.expiresAt) }]} />
      </Section>
      <Section title="Expense claims" pad={false} actions={<Link to="/hr/claims" className="btn btn-glass btn-sm">Claims</Link>}>
        <Table rows={d.claims} rowKey={(c: Any) => c.id} empty="No claims" cols={[{ label: 'Claim', render: (c: Any) => <b>{c.title}</b> }, { label: 'Amount', render: (c: Any) => naira(c.amountKobo), align: 'right' }, { label: 'Status', render: (c: Any) => <Status s={c.status} /> }]} />
      </Section>
    </>
  )
}

function InternTab({ d }: { d: Any }) {
  const i = d.intern
  if (!i) return <Muted>No intern data.</Muted>
  const row = (label: string, s: Any) => (
    <tr key={label}>
      <td><b>{label}</b></td>
      <td className="tnum">{s.submitted}</td>
      <td className="tnum">{s.approved}</td>
      <td className="tnum">{s.rejected}</td>
      <td className="tnum">{s.pending}</td>
      <td className="tnum">{s.approvalRate === null ? '—' : `${s.approvalRate}%`}</td>
    </tr>
  )
  return (
    <>
      <Grid min={170}>
        <Stat label="Earned" value={`₦${i.payouts.earnedNgn.toLocaleString()}`} icon="naira" />
        <Stat label="Paid" value={`₦${i.payouts.paidNgn.toLocaleString()}`} tone="var(--money)" icon="check" />
        <Stat label="Owed" value={`₦${i.payouts.owedNgn.toLocaleString()}`} tone="var(--amber)" icon="clock" />
        <Stat label="Internship ends" value={niceDate(d.file.internshipEndsAt)} icon="calendar" />
      </Grid>
      <div style={{ height: 16 }} />
      <Section title="Submissions" sub="From the storefront intern tools (synced)." pad={false}>
        <div className="tablewrap">
          <table className="dt">
            <thead><tr><th>Kind</th><th>Submitted</th><th>Approved</th><th>Rejected</th><th>Waiting</th><th>Approval rate</th></tr></thead>
            <tbody>{[row('Product images', i.submissions.images), row('Full products', i.submissions.products), row('Documents', i.submissions.documents)]}</tbody>
          </table>
        </div>
      </Section>
      <Section title="Intern payouts" sub="Paid from the storefront admin's intern payroll." pad={false}>
        <Table rows={i.payouts.list} rowKey={(p: Any) => p.id} empty="No payouts yet" cols={[{ label: 'Window', render: (p: Any) => `${niceDate(p.windowFrom)} → ${niceDate(p.windowTo)}` }, { label: 'Items', render: (p: Any) => p.submissionCount, align: 'right' }, { label: 'Amount', render: (p: Any) => `₦${p.totalNgn.toLocaleString()}`, align: 'right' }, { label: 'Status', render: (p: Any) => (p.paidAt ? <Status s="PAID" /> : <Status s="DRAFT" label="Not paid" />) }]} />
      </Section>
    </>
  )
}

// ── Exit and query modals ───────────────────────────────────────────────────

function ExitModal({ id, open, onClose, onDone, intern }: { id: string; open: boolean; onClose: () => void; onDone: () => void; intern: boolean }) {
  const [date, setDate] = useState(today())
  const [reason, setReason] = useState(intern ? 'INTERNSHIP_ENDED' : 'RESIGNED')
  const [note, setNote] = useState('')
  const act = useAction()
  return (
    <Modal open={open} title="Record leaving" subtitle="Opens their leaving checklist. Their access is removed by each product admin; the checklist shows where it's still on." onClose={onClose}>
      <Field label="Last day" htmlFor="x-d"><Input id="x-d" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Reason">
        <Select value={reason} onChange={setReason} options={[{ value: 'RESIGNED', label: 'Resigned' }, { value: 'CONTRACT_ENDED', label: 'Contract ended' }, { value: 'INTERNSHIP_ENDED', label: 'Internship ended' }, { value: 'DISMISSED', label: 'Dismissed' }, { value: 'REDUNDANCY', label: 'Redundancy' }, { value: 'OTHER', label: 'Other' }]} />
      </Field>
      <Field label="Note" htmlFor="x-n"><Textarea id="x-n" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <ErrorLine error={act.error} />
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="danger" loading={!!act.busy} onClick={() => act.run('x', () => hr(`/people/${id}/exit`, { method: 'POST', body: { exitedAt: date, reason, note: note || undefined } }), onDone)}>Record leaving</Button>
      </div>
    </Modal>
  )
}

function QueryModal({ id, open, onClose, onDone }: { id: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const [subject, setSubject] = useState('')
  const [details, setDetails] = useState('')
  const [due, setDue] = useState('')
  const act = useAction()
  return (
    <Modal open={open} title="Issue a query" subtitle="A formal written query. They see it in My HR and respond there; you record the outcome." onClose={onClose}>
      <Field label="Subject" htmlFor="q-s"><Input id="q-s" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Absence without notice on 18 November" /></Field>
      <Field label="Details" htmlFor="q-d"><Textarea id="q-d" rows={6} value={details} onChange={(e) => setDetails(e.target.value)} /></Field>
      <Field label="Respond by (optional)" htmlFor="q-due" help="Defaults to two days from today."><Input id="q-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      <ErrorLine error={act.error} />
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={!!act.busy} disabled={subject.trim().length < 3 || details.trim().length < 10} onClick={() => act.run('q', () => hr(`/people/${id}/queries`, { method: 'POST', body: { subject, details, responseDueAt: due || undefined } }), onDone)}>Issue query</Button>
      </div>
    </Modal>
  )
}

export { typeLabel }
