/**
 * Payroll and expense claims. MANUAL BANK TRANSFER ONLY: nothing here sends
 * money. HR prepares, a second person approves, finance pays each line from
 * the bank app using the transfer sheet, then records the reference.
 */
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import PageHeader from '../../components/PageHeader'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Modal from '../../components/ui/Modal'
import Textarea from '../../components/ui/Textarea'
import { useApi } from '../../lib/useApi'
import { hr, hrFile, naira, niceDate } from '../api'
import { useHr } from '../HrContext'
import { ErrorLine, Field, Grid, Load, Muted, NoAccess, Section, Stat, Status, Table, Tabs, Tag, useAction } from '../ui'
import { PersonCell } from '../charts'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any

const thisMonth = () => new Date(Date.now() + 3_600_000).toISOString().slice(0, 7)

export function HrPayroll() {
  const { can } = useHr()
  const r = useApi((signal) => (can('hr.payroll') ? hr<Any[]>('/payroll', { signal }) : Promise.resolve([])), [])
  const act = useAction()
  const nav = useNavigate()
  const [period, setPeriod] = useState(thisMonth())
  if (!can('hr.payroll')) return <><PageHeader crumb="AZM Staff · Money" title="Payroll" /><NoAccess need="hr.payroll" /></>
  return (
    <>
      <PageHeader crumb="AZM Staff · Money" title="Payroll" sub="Paid by manual bank transfer from the company account. Prepared by one person, approved by another; nobody approves a payroll that pays themselves." />
      <ErrorLine error={act.error} />
      <Section title="Start a month" sub="Builds a payslip for everyone with pay in their file, prorated for anyone who joined or left in the month.">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Input aria-label="Month" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: 180 }} />
          <Button variant="primary" icon="plus" loading={act.busy === 'new'} onClick={() => act.run('new', async () => { const res = await hr<Any>('/payroll', { method: 'POST', body: { period } }); nav(`/hr/payroll/${res.run.id}`) })}>Prepare payroll</Button>
        </div>
      </Section>
      <Section title="Months" pad={false}>
        <Load r={r}>
          {(rows) => (
            <Table
              rows={rows}
              rowKey={(x: Any) => x.id}
              onRow={(x: Any) => nav(`/hr/payroll/${x.id}`)}
              empty="No payroll yet"
              emptyIcon="naira"
              cols={[
                { label: 'Month', render: (x: Any) => <b>{x.period}</b> },
                { label: 'People', render: (x: Any) => x.people, align: 'right' },
                { label: 'Gross', render: (x: Any) => naira(x.grossKobo), align: 'right' },
                { label: 'Net to pay', render: (x: Any) => <b>{naira(x.netKobo)}</b>, align: 'right' },
                { label: 'Status', render: (x: Any) => <Status s={x.status} /> },
                { label: 'Prepared / approved', render: (x: Any) => <Muted>{x.preparedByName ?? '—'} / {x.approvedByName ?? '—'}</Muted> },
              ]}
            />
          )}
        </Load>
      </Section>
    </>
  )
}

export function HrPayrollRun() {
  const { id = '' } = useParams()
  const { can, me } = useHr()
  const r = useApi((signal) => hr<Any>(`/payroll/${id}`, { signal }), [id])
  const act = useAction()
  const [paying, setPaying] = useState<Any | null>(null)
  const [ref, setRef] = useState('')
  const [adjusting, setAdjusting] = useState<Any | null>(null)
  const [adj, setAdj] = useState<{ label: string; naira: string }[]>([])
  const [sendBack, setSendBack] = useState(false)
  const [note, setNote] = useState('')
  const post = (path: string, body?: unknown) => act.run(path, () => hr(`/payroll/${id}/${path}`, { method: 'POST', body }), r.reload)

  return (
    <Load r={r}>
      {(d) => {
        const run = d.run
        const t = d.totals
        const iPrepared = run.preparedById === me?.id
        return (
          <>
            <PageHeader
              crumb={<Link to="/hr/payroll">Payroll</Link> as unknown as string}
              title={`Payroll ${run.period}`}
              sub={<span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><Status s={run.status} /> Prepared by {run.preparedByName ?? '—'}{run.approvedByName ? ` · approved by ${run.approvedByName}` : ''}</span>}
              actions={
                <>
                  {run.status === 'DRAFT' && <><Button onClick={() => post('recalc')} loading={act.busy === 'recalc'}>Recalculate</Button><Button variant="danger" onClick={() => confirm('Cancel this payroll?') && post('cancel')}>Cancel</Button><Button variant="primary" onClick={() => post('submit')} loading={act.busy === 'submit'}>Submit for approval</Button></>}
                  {run.status === 'SUBMITTED' && can('hr.payroll.approve') && <><Button onClick={() => { setSendBack(true); setNote('') }}>Send back</Button><Button variant="money" icon="check" disabled={iPrepared} title={iPrepared ? 'Someone other than the preparer must approve' : undefined} onClick={() => post('approve')} loading={act.busy === 'approve'}>Approve</Button></>}
                  {['APPROVED', 'PAID'].includes(run.status) && can('hr.sensitive') && <Button variant="primary" icon="download" onClick={() => act.run('sheet', () => hrFile(`/payroll/${id}/transfer-sheet.csv`, { download: `azm-payroll-${run.period}.csv` }))}>Transfer sheet</Button>}
                  {run.status === 'APPROVED' && can('hr.payroll.approve') && <Button onClick={() => { setSendBack(true); setNote('') }}>Send back</Button>}
                </>
              }
            />
            <ErrorLine error={act.error} />
            <Grid min={170}>
              <Stat label="Net to pay" value={naira(t.netKobo, 0)} icon="naira" />
              <Stat label="Paid so far" value={naira(t.paidKobo, 0)} icon="check" tone="var(--money)" />
              <Stat label="PAYE to remit" value={naira(t.payeKobo, 0)} hint="to the state IRS" />
              <Stat label="Pension to remit" value={naira(t.pensionEeKobo + t.pensionErKobo, 0)} hint={`${naira(t.pensionEeKobo, 0)} staff + ${naira(t.pensionErKobo, 0)} AZM`} />
              <Stat label="NHF to remit" value={naira(t.nhfKobo, 0)} hint="to FMBN" />
            </Grid>
            <div style={{ height: 16 }} />
            {run.status === 'APPROVED' && <Section><Muted>Pay each line from the bank app using the transfer sheet, then press <b>Paid</b> and enter the transfer reference from the receipt. Nothing is sent from here.</Muted></Section>}
            <Section pad={false} title="Payslips">
              <Table
                rows={d.slips}
                rowKey={(s: Any) => s.id}
                cols={[
                  { label: 'Person', render: (s: Any) => <PersonCell userId={s.userId} name={s.name} /> },
                  { label: 'Gross', render: (s: Any) => naira(s.grossKobo), align: 'right' },
                  { label: 'Pension', render: (s: Any) => naira(s.pensionEeKobo), align: 'right' },
                  { label: 'NHF', render: (s: Any) => naira(s.nhfKobo), align: 'right' },
                  { label: 'PAYE', render: (s: Any) => naira(s.payeKobo), align: 'right' },
                  { label: 'Other', render: (s: Any) => (s.adjustKobo ? <span title={s.adjustments.map((a: Any) => `${a.label}: ${naira(a.kobo)}`).join('\n')}>{naira(s.adjustKobo)}</span> : '—'), align: 'right' },
                  { label: 'Net', render: (s: Any) => <b>{naira(s.netKobo)}</b>, align: 'right' },
                  { label: 'Paid', render: (s: Any) => (s.paidAt ? <Tag tone="ok">{s.transferRef}</Tag> : <Muted>—</Muted>) },
                  {
                    label: '',
                    align: 'right',
                    render: (s: Any) => (
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        {run.status === 'DRAFT' && <Button size="sm" onClick={() => { setAdjusting(s); setAdj(s.adjustments.map((a: Any) => ({ label: a.label, naira: String(a.kobo / 100) }))) }}>Additions / deductions</Button>}
                        {run.status === 'APPROVED' && !s.paidAt && <Button size="sm" variant="money" disabled={s.userId === me?.id} title={s.userId === me?.id ? 'Someone else must record your own pay' : undefined} onClick={() => { setPaying(s); setRef('') }}>Paid</Button>}
                      </div>
                    ),
                  },
                ]}
              />
            </Section>
            <Muted>Rates come from HR settings (Nigeria Tax Act 2025 bands by default). Have the accountant check the settings before the first run.</Muted>

            <Modal open={!!paying} title="Record the transfer" subtitle={paying ? `${naira(paying.netKobo)} to ${paying.name}. Only once the money has left the account.` : ''} onClose={() => setPaying(null)}>
              <Field label="Bank transfer reference" htmlFor="pr"><Input id="pr" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="From the bank app's receipt" /></Field>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <Button onClick={() => setPaying(null)}>Cancel</Button>
                <Button variant="money" disabled={ref.trim().length < 3} loading={!!act.busy} onClick={() => act.run('pay', () => hr(`/payslips/${paying.id}/paid`, { method: 'POST', body: { transferRef: ref.trim() } }), () => { setPaying(null); r.reload() })}>Mark paid</Button>
              </div>
            </Modal>
            <Modal open={!!adjusting} title={`Additions and deductions · ${adjusting?.name ?? ''}`} subtitle="One-off for this month: bonus, arrears, salary advance repayment. Use a minus sign for deductions." onClose={() => setAdjusting(null)}>
              {adj.map((a, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 40px', gap: 8, marginBottom: 8 }}>
                  <Input aria-label="Label" value={a.label} onChange={(e) => setAdj(adj.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="e.g. Performance bonus" />
                  <Input aria-label="Amount ₦" type="number" value={a.naira} onChange={(e) => setAdj(adj.map((x, j) => (j === i ? { ...x, naira: e.target.value } : x)))} />
                  <Button size="sm" variant="danger" onClick={() => setAdj(adj.filter((_, j) => j !== i))} aria-label="Remove">×</Button>
                </div>
              ))}
              <Button size="sm" icon="plus" onClick={() => setAdj([...adj, { label: '', naira: '' }])}>Add line</Button>
              <ErrorLine error={act.error} />
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}>
                <Button onClick={() => setAdjusting(null)}>Cancel</Button>
                <Button variant="primary" loading={!!act.busy} onClick={() => act.run('adj', () => hr(`/payslips/${adjusting.id}/adjustments`, { method: 'PUT', body: { adjustments: adj.filter((a) => a.label && a.naira).map((a) => ({ label: a.label, kobo: Math.round(Number(a.naira) * 100) })) } }), () => { setAdjusting(null); r.reload() })}>Save</Button>
              </div>
            </Modal>
            <Modal open={sendBack} title="Send back to draft" subtitle="The preparer fixes it and submits again." onClose={() => setSendBack(false)}>
              <Field label="What needs fixing" htmlFor="sb"><Textarea id="sb" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <Button onClick={() => setSendBack(false)}>Cancel</Button>
                <Button variant="primary" loading={!!act.busy} onClick={() => act.run('sb', () => hr(`/payroll/${id}/send-back`, { method: 'POST', body: { note } }), () => { setSendBack(false); r.reload() })}>Send back</Button>
              </div>
            </Modal>
          </>
        )
      }}
    </Load>
  )
}

const CLAIM_KIND: Record<string, string> = { RELOCATION: 'Relocation', WELFARE: 'Welfare', PER_DIEM: 'Per diem', ACCOMMODATION: 'Accommodation', TRANSPORT: 'Transport', OTHER: 'Other' }

export function HrClaims() {
  const [status, setStatus] = useState<'PENDING_HR' | 'APPROVED' | 'PENDING_MANAGER' | ''>('PENDING_HR')
  const r = useApi((signal) => hr<Any[]>(`/claims${status ? `?status=${status}` : ''}`, { signal }), [status])
  const { can, me } = useHr()
  const act = useAction()
  const [paying, setPaying] = useState<Any | null>(null)
  const [ref, setRef] = useState('')
  return (
    <>
      <PageHeader crumb="AZM Staff · Money" title="Expense claims" sub="Relocation, welfare, per diem, accommodation, transport. Staff claim in My HR with receipts; the line manager, then HR approve; finance pays by bank transfer and records the reference." />
      <Tabs value={status} onChange={setStatus} tabs={[{ value: 'PENDING_HR', label: 'To approve' }, { value: 'APPROVED', label: 'To pay' }, { value: 'PENDING_MANAGER', label: 'With managers' }, { value: '', label: 'All' }]} />
      <ErrorLine error={act.error} />
      <Section pad={false}>
        <Load r={r}>
          {(rows) => (
            <Table
              rows={rows}
              rowKey={(c: Any) => c.id}
              empty="Nothing here"
              emptyIcon="naira"
              cols={[
                { label: 'Person', render: (c: Any) => <PersonCell userId={c.userId} name={c.name} /> },
                { label: 'Claim', render: (c: Any) => <div>{c.title}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{CLAIM_KIND[c.kind]} · {niceDate(c.spentOn ?? c.createdAt)} · {c.receiptIds.length} receipt(s)</div></div> },
                { label: 'Amount', render: (c: Any) => <b>{naira(c.amountKobo)}</b>, align: 'right' },
                { label: 'Status', render: (c: Any) => <Status s={c.status} /> },
                { label: 'Trail', render: (c: Any) => <Muted>{[c.managerName && `Mgr ${c.managerName}`, c.hrName && `HR ${c.hrName}`, c.paidRef && `Ref ${c.paidRef}`].filter(Boolean).join(' · ') || '—'}</Muted> },
                {
                  label: '',
                  align: 'right',
                  render: (c: Any) => (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {c.receiptIds.map((rid: string, i: number) => <Button key={rid} size="sm" icon="eye" onClick={() => act.run('r' + rid, () => hrFile(`/documents/${rid}/file`))}>{`Receipt ${i + 1}`}</Button>)}
                      {can('hr.manage') && ['PENDING_HR', 'PENDING_MANAGER'].includes(c.status) && c.userId !== me?.id && <><Button size="sm" variant="danger" onClick={() => act.run('x' + c.id, () => hr(`/claims/${c.id}/decide`, { method: 'POST', body: { approve: false } }), r.reload)}>Decline</Button><Button size="sm" variant="money" onClick={() => act.run('a' + c.id, () => hr(`/claims/${c.id}/decide`, { method: 'POST', body: { approve: true } }), r.reload)}>Approve</Button></>}
                      {can('hr.payroll') && c.status === 'APPROVED' && <Button size="sm" variant="money" disabled={c.userId === me?.id || c.hrById === me?.id} title={c.hrById === me?.id ? 'You approved it, so someone else records paying it' : undefined} onClick={() => { setPaying(c); setRef('') }}>Paid</Button>}
                    </div>
                  ),
                },
              ]}
            />
          )}
        </Load>
      </Section>
      <Modal open={!!paying} title="Record the transfer" subtitle={paying ? `${naira(paying.amountKobo)} to ${paying.name}` : ''} onClose={() => setPaying(null)}>
        <Field label="Bank transfer reference" htmlFor="cr"><Input id="cr" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button onClick={() => setPaying(null)}>Cancel</Button>
          <Button variant="money" disabled={ref.trim().length < 3} loading={!!act.busy} onClick={() => act.run('p', () => hr(`/claims/${paying.id}/paid`, { method: 'POST', body: { transferRef: ref.trim() } }), () => { setPaying(null); r.reload() })}>Mark paid</Button>
        </div>
      </Modal>
    </>
  )
}
