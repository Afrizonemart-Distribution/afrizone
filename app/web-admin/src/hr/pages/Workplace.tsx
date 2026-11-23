/** Assets, performance reviews, queries, policies and announcements. */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../../components/PageHeader'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Modal from '../../components/ui/Modal'
import Select from '../../components/ui/Select'
import Switch from '../../components/ui/Switch'
import Textarea from '../../components/ui/Textarea'
import { useApi } from '../../lib/useApi'
import { hr, niceDate, STAFF_TYPES, today } from '../api'
import { useHr } from '../HrContext'
import { ErrorLine, Field, FormGrid, Load, Muted, Section, Status, Table, Tabs, Tag, useAction } from '../ui'
import type { DirPerson } from './People'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any

function usePeopleOptions() {
  const r = useApi((signal) => hr<DirPerson[]>('/directory', { signal }), [])
  return (r.data ?? []).map((p) => ({ value: p.userId, label: p.name ?? p.email ?? p.userId }))
}

// ── Assets ──────────────────────────────────────────────────────────────────

const ASSET_KINDS = ['LAPTOP', 'PHONE', 'SIM', 'MONITOR', 'ID_CARD', 'VEHICLE', 'OTHER'].map((k) => ({ value: k, label: k.replace('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }))

export function HrAssets() {
  const r = useApi((signal) => hr<Any[]>('/assets', { signal }), [])
  const { can } = useHr()
  const people = usePeopleOptions()
  const act = useAction()
  const [edit, setEdit] = useState<Any | null>(null)
  const [move, setMove] = useState<{ a: Any; action: 'ASSIGN' | 'RETURN' | 'RETIRE' } | null>(null)
  const [who, setWho] = useState('')
  const [note, setNote] = useState('')
  const [tab, setTab] = useState<'out' | 'store' | 'all'>('out')
  return (
    <>
      <PageHeader crumb="AZM Staff · HR" title="Company assets" sub="Laptops, phones, SIMs, ID cards. Who holds what; leavers' checklists won't complete until theirs are back." actions={can('hr.manage') && <Button variant="primary" icon="plus" onClick={() => setEdit({ tag: '', kind: 'LAPTOP', description: '', serial: '', condition: '' })}>Add asset</Button>} />
      <ErrorLine error={act.error} />
      <Load r={r}>
        {(rows) => (
          <>
            <Tabs value={tab} onChange={setTab} tabs={[{ value: 'out', label: 'With staff', count: rows.filter((a) => a.holderId).length }, { value: 'store', label: 'In store', count: rows.filter((a) => !a.holderId && !a.retiredAt).length }, { value: 'all', label: 'All' }]} />
            <Section pad={false}>
              <Table
                rows={rows.filter((a) => (tab === 'out' ? a.holderId : tab === 'store' ? !a.holderId && !a.retiredAt : true))}
                rowKey={(a: Any) => a.id}
                empty="No assets here"
                cols={[
                  { label: 'Tag', render: (a: Any) => <b>{a.tag}</b> },
                  { label: 'Item', render: (a: Any) => <div>{a.description}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{a.kind.toLowerCase()}{a.serial ? ` · ${a.serial}` : ''}</div></div> },
                  { label: 'Holder', render: (a: Any) => (a.holderId ? <Link to={`/hr/people/${a.holderId}`} style={{ fontWeight: 700 }}>{a.holderName}</Link> : a.retiredAt ? <Tag>Retired</Tag> : <Muted>In store</Muted>) },
                  { label: 'Since', render: (a: Any) => niceDate(a.assignedAt) },
                  { label: 'Condition', render: (a: Any) => <Muted>{a.condition ?? '—'}</Muted> },
                  {
                    label: '',
                    align: 'right',
                    render: (a: Any) =>
                      can('hr.manage') && !a.retiredAt ? (
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <Button size="sm" onClick={() => setEdit({ ...a })}>Edit</Button>
                          {a.holderId ? <Button size="sm" variant="glass" onClick={() => { setMove({ a, action: 'RETURN' }); setNote('') }}>Returned</Button> : <><Button size="sm" variant="primary" onClick={() => { setMove({ a, action: 'ASSIGN' }); setWho(''); setNote('') }}>Give to…</Button><Button size="sm" variant="danger" onClick={() => { setMove({ a, action: 'RETIRE' }); setNote('') }}>Retire</Button></>}
                        </div>
                      ) : null,
                  },
                ]}
              />
            </Section>
          </>
        )}
      </Load>
      <Modal open={!!edit} title={edit?.id ? 'Edit asset' : 'Add asset'} onClose={() => setEdit(null)}>
        {edit && (
          <>
            <FormGrid>
              <Field label="Asset tag" htmlFor="as-t"><Input id="as-t" value={edit.tag} onChange={(e) => setEdit({ ...edit, tag: e.target.value })} placeholder="AZM-LT-014" /></Field>
              <Field label="Kind"><Select value={edit.kind} onChange={(v) => setEdit({ ...edit, kind: v })} options={ASSET_KINDS} /></Field>
              <Field label="Description" htmlFor="as-d" span><Input id="as-d" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} placeholder="HP ProBook 450 G9" /></Field>
              <Field label="Serial" htmlFor="as-s"><Input id="as-s" value={edit.serial ?? ''} onChange={(e) => setEdit({ ...edit, serial: e.target.value })} /></Field>
              <Field label="Condition" htmlFor="as-c"><Input id="as-c" value={edit.condition ?? ''} onChange={(e) => setEdit({ ...edit, condition: e.target.value })} /></Field>
            </FormGrid>
            <ErrorLine error={act.error} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Button onClick={() => setEdit(null)}>Cancel</Button>
              <Button variant="primary" loading={!!act.busy} onClick={() => act.run('s', () => hr(edit.id ? `/assets/${edit.id}` : '/assets', { method: edit.id ? 'PUT' : 'POST', body: { tag: edit.tag, kind: edit.kind, description: edit.description, serial: edit.serial || null, condition: edit.condition || null } }), () => { setEdit(null); r.reload() })}>Save</Button>
            </div>
          </>
        )}
      </Modal>
      <Modal open={!!move} title={move?.action === 'ASSIGN' ? `Give ${move.a.tag} to…` : move?.action === 'RETURN' ? `${move?.a.tag} returned` : `Retire ${move?.a.tag}`} onClose={() => setMove(null)}>
        {move?.action === 'ASSIGN' && <Field label="Staff member"><Select value={who} onChange={setWho} options={people} placeholder="Pick someone" /></Field>}
        <Field label={move?.action === 'RETURN' ? 'Condition on return' : 'Note'} htmlFor="mv-n"><Input id="mv-n" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <ErrorLine error={act.error} />
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button onClick={() => setMove(null)}>Cancel</Button>
          <Button variant="primary" loading={!!act.busy} disabled={move?.action === 'ASSIGN' && !who} onClick={() => move && act.run('m', () => hr(`/assets/${move.a.id}/move`, { method: 'POST', body: { action: move.action, userId: who || undefined, note: note || undefined } }), () => { setMove(null); r.reload() })}>Confirm</Button>
        </div>
      </Modal>
    </>
  )
}

// ── Reviews ─────────────────────────────────────────────────────────────────

export function HrReviews() {
  const cycles = useApi((signal) => hr<Any[]>('/reviews/cycles', { signal }), [])
  const [cycleId, setCycleId] = useState('')
  const reviews = useApi((signal) => (cycleId ? hr<Any[]>(`/reviews?cycleId=${cycleId}`, { signal }) : Promise.resolve([])), [cycleId])
  const { can } = useHr()
  const act = useAction()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', periodStart: '', periodEnd: today(), staffType: '' })
  const [editing, setEditing] = useState<Any | null>(null)
  const people = usePeopleOptions()
  return (
    <>
      <PageHeader crumb="AZM Staff · HR" title="Performance reviews" sub="Each review starts with the person's KPI for the period, frozen when the cycle opens. They fill in their part in My HR; their manager finishes it." actions={can('hr.manage') && <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>Open a review cycle</Button>} />
      <ErrorLine error={act.error} />
      <Section title="Cycles" pad={false}>
        <Load r={cycles}>
          {(rows) => (
            <Table
              rows={rows}
              rowKey={(c: Any) => c.id}
              onRow={(c: Any) => setCycleId(c.id)}
              empty="No review cycles yet"
              cols={[
                { label: 'Cycle', render: (c: Any) => <b style={{ color: c.id === cycleId ? 'var(--navy)' : undefined }}>{c.name}</b> },
                { label: 'Period', render: (c: Any) => `${niceDate(c.periodStart)} → ${niceDate(c.periodEnd)}` },
                { label: 'Progress', render: (c: Any) => `${c.done} done · ${c.manager} with reviewer · ${c.self} self` },
                { label: 'Status', render: (c: Any) => <Status s={c.status} /> },
                { label: '', align: 'right', render: (c: Any) => (can('hr.manage') && c.status === 'OPEN' ? <Button size="sm" onClick={(e) => { e.stopPropagation(); act.run('cl' + c.id, () => hr(`/reviews/cycles/${c.id}/close`, { method: 'POST' }), cycles.reload) }}>Close</Button> : null) },
              ]}
            />
          )}
        </Load>
      </Section>
      {cycleId && (
        <Section title="Reviews in this cycle" pad={false}>
          <Load r={reviews}>
            {(rows) => (
              <Table
                rows={rows}
                rowKey={(x: Any) => x.id}
                cols={[
                  { label: 'Person', render: (x: Any) => <Link to={`/hr/people/${x.userId}`} style={{ fontWeight: 700 }}>{x.name}</Link> },
                  { label: 'Reviewer', render: (x: Any) => (can('hr.manage') && x.status !== 'DONE' ? <Select value={x.reviewerId ?? ''} onChange={(v) => act.run('rv' + x.id, () => hr(`/reviews/${x.id}/reviewer`, { method: 'POST', body: { reviewerId: v } }), reviews.reload)} options={people.filter((p) => p.value !== x.userId)} placeholder="Pick a reviewer" /> : x.reviewerName ?? '—') },
                  { label: 'Status', render: (x: Any) => <Status s={x.status} /> },
                  { label: 'KPI', render: (x: Any) => (x.kpiSnapshot?.score !== undefined ? `${Math.round(x.kpiSnapshot.score)}` : <Muted>—</Muted>) },
                  { label: 'Rating', render: (x: Any) => (x.managerRating ? `${x.managerRating} / 5` : '—') },
                  { label: '', align: 'right', render: (x: Any) => <Button size="sm" onClick={() => setEditing(x)}>{can('hr.manage') && x.status !== 'DONE' ? 'Open' : 'View'}</Button> },
                ]}
              />
            )}
          </Load>
        </Section>
      )}
      <Modal open={open} title="Open a review cycle" subtitle="Creates a review for everyone (or one staff type), with their line manager as reviewer." onClose={() => setOpen(false)}>
        <Field label="Name" htmlFor="rc-n"><Input id="rc-n" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Q4 2026" /></Field>
        <FormGrid>
          <Field label="Period start" htmlFor="rc-s"><Input id="rc-s" type="date" value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} /></Field>
          <Field label="Period end" htmlFor="rc-e"><Input id="rc-e" type="date" value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} /></Field>
        </FormGrid>
        <Field label="Who"><Select value={form.staffType} onChange={(v) => setForm({ ...form, staffType: v })} options={[{ value: '', label: 'Everyone' }, ...STAFF_TYPES]} /></Field>
        <ErrorLine error={act.error} />
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" loading={!!act.busy} disabled={!form.name || !form.periodStart} onClick={() => act.run('o', () => hr('/reviews/cycles', { method: 'POST', body: { ...form, staffType: form.staffType || undefined } }), () => { setOpen(false); cycles.reload() })}>Open cycle</Button>
        </div>
      </Modal>
      {editing && <ReviewModal review={editing} canEdit={can('hr.manage') && editing.status !== 'DONE'} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reviews.reload() }} />}
    </>
  )
}

function ReviewModal({ review, canEdit, onClose, onSaved }: { review: Any; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const [goals, setGoals] = useState<Any[]>(review.goals?.length ? review.goals : [{ title: '', weight: 0 }])
  const [notes, setNotes] = useState(review.managerNotes ?? '')
  const [rating, setRating] = useState(String(review.managerRating ?? 3))
  const act = useAction()
  const save = (submit: boolean) => act.run('s', () => hr(`/reviews/${review.id}`, { method: 'PUT', body: { goals: goals.filter((g) => g.title).map((g) => ({ ...g, weight: Number(g.weight) || 0, managerScore: g.managerScore ? Number(g.managerScore) : null })), managerNotes: notes, managerRating: Number(rating), submit } }), onSaved)
  return (
    <Modal open title={`${review.name} · ${review.cycleName}`} subtitle={review.selfAt ? `Their self review came in ${niceDate(review.selfAt)}.` : 'Their self review isn’t in yet.'} onClose={onClose} size="wide">
      {review.kpiSnapshot && (
        <Section title="KPI for the period (frozen)">
          <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', margin: 0, maxHeight: 160, overflow: 'auto' }}>{JSON.stringify(review.kpiSnapshot.pillars ?? review.kpiSnapshot, null, 1)}</pre>
        </Section>
      )}
      {review.selfNotes && <Section title="Their notes"><p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{review.selfNotes}</p></Section>}
      <Section title="Goals">
        {goals.map((g, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 90px 90px', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <Input aria-label="Goal" value={g.title} onChange={(e) => setGoals(goals.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} disabled={!canEdit} placeholder="Goal" />
            <Input aria-label="Weight %" type="number" value={g.weight ?? 0} onChange={(e) => setGoals(goals.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))} disabled={!canEdit} />
            <Muted>Self: {g.selfScore ?? '—'}</Muted>
            <Input aria-label="Manager score 1-5" type="number" min={1} max={5} value={g.managerScore ?? ''} onChange={(e) => setGoals(goals.map((x, j) => (j === i ? { ...x, managerScore: e.target.value } : x)))} disabled={!canEdit} placeholder="1–5" />
          </div>
        ))}
        {canEdit && <Button size="sm" icon="plus" onClick={() => setGoals([...goals, { title: '', weight: 0 }])}>Add goal</Button>}
      </Section>
      <Field label="Reviewer notes" htmlFor="rv-n"><Textarea id="rv-n" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canEdit} /></Field>
      <Field label="Overall rating"><Select value={rating} onChange={setRating} options={['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: `${v} — ${['Below expectations', 'Partly meets', 'Meets', 'Exceeds', 'Outstanding'][Number(v) - 1]}` }))} disabled={!canEdit} /></Field>
      <ErrorLine error={act.error} />
      {canEdit && (
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button onClick={() => save(false)} loading={act.busy === 's'}>Save draft</Button>
          <Button variant="primary" onClick={() => save(true)} loading={act.busy === 's'}>Finish review</Button>
        </div>
      )}
    </Modal>
  )
}

// ── Queries ─────────────────────────────────────────────────────────────────

const OUTCOMES = [
  { value: 'CLEARED', label: 'Cleared, no action' },
  { value: 'CAUTION', label: 'Verbal caution' },
  { value: 'WARNING', label: 'Written warning' },
  { value: 'FINAL_WARNING', label: 'Final warning' },
  { value: 'SUSPENSION', label: 'Suspension' },
  { value: 'DISMISSAL', label: 'Dismissal' },
]

export function HrQueries() {
  const [open, setOpen] = useState(true)
  const r = useApi((signal) => hr<Any[]>(`/queries?open=${open ? 1 : 0}`, { signal }), [open])
  const { can } = useHr()
  const act = useAction()
  const [closing, setClosing] = useState<Any | null>(null)
  const [outcome, setOutcome] = useState('CLEARED')
  const [note, setNote] = useState('')
  const [viewing, setViewing] = useState<Any | null>(null)
  return (
    <>
      <PageHeader crumb="AZM Staff · HR" title="Queries & discipline" sub="Issue a query from someone's page. They respond in My HR; you record the outcome. Everything stays on their record." />
      <Tabs value={open ? 'open' : 'all'} onChange={(v) => setOpen(v === 'open')} tabs={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }]} />
      <ErrorLine error={act.error} />
      <Section pad={false}>
        <Load r={r}>
          {(rows) => (
            <Table
              rows={rows}
              rowKey={(q: Any) => q.id}
              onRow={setViewing}
              empty="No queries"
              cols={[
                { label: 'Person', render: (q: Any) => <Link to={`/hr/people/${q.userId}`} style={{ fontWeight: 700 }} onClick={(e) => e.stopPropagation()}>{q.name}</Link> },
                { label: 'Subject', render: (q: Any) => q.subject },
                { label: 'Issued', render: (q: Any) => <Muted>{niceDate(q.createdAt)} by {q.issuedByName}</Muted> },
                { label: 'Response', render: (q: Any) => (q.respondedAt ? <Tag tone="ok">In</Tag> : q.overdue ? <Tag tone="bad">Overdue</Tag> : <Muted>Due {niceDate(q.responseDueAt)}</Muted>) },
                { label: 'Outcome', render: (q: Any) => (q.closedAt ? OUTCOMES.find((o) => o.value === q.outcome)?.label : <Muted>Open</Muted>) },
                { label: '', align: 'right', render: (q: Any) => (can('hr.manage') && !q.closedAt ? <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); setClosing(q); setOutcome('CLEARED'); setNote('') }}>Record outcome</Button> : null) },
              ]}
            />
          )}
        </Load>
      </Section>
      <Modal open={!!viewing} title={viewing?.subject ?? ''} subtitle={viewing ? `${viewing.name} · issued ${niceDate(viewing.createdAt)}` : ''} onClose={() => setViewing(null)}>
        {viewing && (
          <>
            <Section title="Query"><p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{viewing.details}</p></Section>
            <Section title="Their response">{viewing.response ? <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{viewing.response}</p> : <Muted>Not in yet.</Muted>}</Section>
            {viewing.closedAt && <Section title="Outcome"><b>{OUTCOMES.find((o) => o.value === viewing.outcome)?.label}</b>{viewing.outcomeNote && <p style={{ whiteSpace: 'pre-wrap' }}>{viewing.outcomeNote}</p>}</Section>}
          </>
        )}
      </Modal>
      <Modal open={!!closing} title="Record the outcome" subtitle={closing ? `${closing.name}: ${closing.subject}` : ''} onClose={() => setClosing(null)}>
        <Field label="Outcome"><Select value={outcome} onChange={setOutcome} options={OUTCOMES} /></Field>
        <Field label="Note" htmlFor="qo-n"><Textarea id="qo-n" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Muted>A warning letter can be added to their documents from their page.</Muted>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
          <Button onClick={() => setClosing(null)}>Cancel</Button>
          <Button variant="primary" loading={!!act.busy} onClick={() => act.run('c', () => hr(`/queries/${closing.id}/close`, { method: 'POST', body: { outcome, note: note || undefined } }), () => { setClosing(null); r.reload() })}>Save</Button>
        </div>
      </Modal>
    </>
  )
}

// ── Policies and announcements ──────────────────────────────────────────────

export function HrPolicies() {
  const [tab, setTab] = useState<'policies' | 'news'>('policies')
  return (
    <>
      <PageHeader crumb="AZM Staff · HR" title="Policies & announcements" sub="Handbook policies staff must read and acknowledge (a new version asks everyone again), and company notices shown in My HR." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'policies', label: 'Policies' }, { value: 'news', label: 'Announcements' }]} />
      {tab === 'policies' ? <Policies /> : <Announcements />}
    </>
  )
}

function Policies() {
  const r = useApi((signal) => hr<Any[]>('/policies', { signal }), [])
  const { can } = useHr()
  const act = useAction()
  const [edit, setEdit] = useState<Any | null>(null)
  const [acks, setAcks] = useState<{ p: Any; rows: Any[] } | null>(null)
  return (
    <Section pad={false} actions={can('hr.manage') && <Button variant="primary" icon="plus" onClick={() => setEdit({ title: '', body: '', requiresAck: true })}>New policy</Button>}>
      <ErrorLine error={act.error} />
      <Load r={r}>
        {(rows) => (
          <Table
            rows={rows}
            rowKey={(p: Any) => p.id}
            empty="No policies yet"
            cols={[
              { label: 'Policy', render: (p: Any) => <div><b>{p.title}</b> <Muted>v{p.version}</Muted></div> },
              { label: 'Status', render: (p: Any) => (p.archivedAt ? <Tag>Archived</Tag> : p.publishedAt ? <Tag tone="ok">Published</Tag> : <Tag tone="warn">Draft</Tag>) },
              { label: 'Acknowledged', render: (p: Any) => (p.publishedAt && p.requiresAck ? <button className="chip" style={{ cursor: 'pointer' }} onClick={() => hr<Any[]>(`/policies/${p.id}/acks`).then((rows) => setAcks({ p, rows }))}>{p.acknowledged} / {p.staff}</button> : <Muted>—</Muted>) },
              {
                label: '',
                align: 'right',
                render: (p: Any) =>
                  can('hr.manage') ? (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Button size="sm" onClick={() => setEdit({ ...p })}>Edit</Button>
                      {!p.publishedAt || p.archivedAt ? <Button size="sm" variant="primary" onClick={() => act.run('p' + p.id, () => hr(`/policies/${p.id}/publish`, { method: 'POST', body: { publish: true } }), r.reload)}>Publish</Button> : <Button size="sm" onClick={() => act.run('a' + p.id, () => hr(`/policies/${p.id}/publish`, { method: 'POST', body: { publish: false } }), r.reload)}>Archive</Button>}
                    </div>
                  ) : null,
              },
            ]}
          />
        )}
      </Load>
      <Modal open={!!edit} title={edit?.id ? 'Edit policy' : 'New policy'} subtitle={edit?.publishedAt ? 'Changing the text of a published policy makes a new version that everyone acknowledges again.' : ''} onClose={() => setEdit(null)} size="wide">
        {edit && (
          <>
            <Field label="Title" htmlFor="po-t"><Input id="po-t" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
            <Field label="Text" htmlFor="po-b"><Textarea id="po-b" rows={14} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5 }}><Switch checked={edit.requiresAck} onChange={(v) => setEdit({ ...edit, requiresAck: v })} label="Staff must acknowledge" /> Staff must acknowledge it</label>
            <ErrorLine error={act.error} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
              <Button onClick={() => setEdit(null)}>Cancel</Button>
              <Button variant="primary" loading={!!act.busy} onClick={() => act.run('s', () => hr(edit.id ? `/policies/${edit.id}` : '/policies', { method: edit.id ? 'PUT' : 'POST', body: { title: edit.title, body: edit.body, requiresAck: edit.requiresAck } }), () => { setEdit(null); r.reload() })}>Save</Button>
            </div>
          </>
        )}
      </Modal>
      <Modal open={!!acks} title={acks ? `${acks.p.title} v${acks.p.version}` : ''} subtitle="Who has acknowledged this version" onClose={() => setAcks(null)}>
        {acks && <Table rows={acks.rows} rowKey={(a: Any) => a.userId} cols={[{ label: 'Person', render: (a: Any) => a.name }, { label: 'Acknowledged', render: (a: Any) => (a.ackAt ? niceDate(a.ackAt) : <Tag tone="warn">Not yet</Tag>) }]} />}
      </Modal>
    </Section>
  )
}

function Announcements() {
  const r = useApi((signal) => hr<Any[]>('/announcements', { signal }), [])
  const { can } = useHr()
  const act = useAction()
  const [edit, setEdit] = useState<Any | null>(null)
  return (
    <Section pad={false} actions={can('hr.manage') && <Button variant="primary" icon="plus" onClick={() => setEdit({ title: '', body: '', audience: 'ALL', pinned: false, expiresAt: '' })}>New announcement</Button>}>
      <ErrorLine error={act.error} />
      <Load r={r}>
        {(rows) => (
          <Table
            rows={rows}
            rowKey={(a: Any) => a.id}
            empty="No announcements"
            cols={[
              { label: 'Announcement', render: (a: Any) => <div><b>{a.title}</b> {a.pinned && <Tag tone="warn">Pinned</Tag>}<div style={{ fontSize: 12.5, color: 'var(--muted)', maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.body}</div></div> },
              { label: 'For', render: (a: Any) => (a.audience === 'ALL' ? 'Everyone' : STAFF_TYPES.find((s) => s.value === a.audience)?.label) },
              { label: 'Posted', render: (a: Any) => niceDate(a.publishedAt) },
              { label: 'Until', render: (a: Any) => niceDate(a.expiresAt) },
              { label: '', align: 'right', render: (a: Any) => (can('hr.manage') ? <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}><Button size="sm" onClick={() => setEdit({ ...a, expiresAt: a.expiresAt?.slice(0, 10) ?? '' })}>Edit</Button><Button size="sm" variant="danger" onClick={() => confirm('Delete this announcement?') && act.run('d' + a.id, () => hr(`/announcements/${a.id}`, { method: 'DELETE' }), r.reload)}>Delete</Button></div> : null) },
            ]}
          />
        )}
      </Load>
      <Modal open={!!edit} title={edit?.id ? 'Edit announcement' : 'New announcement'} onClose={() => setEdit(null)}>
        {edit && (
          <>
            <Field label="Title" htmlFor="an-t"><Input id="an-t" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
            <Field label="Message" htmlFor="an-b"><Textarea id="an-b" rows={6} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
            <FormGrid>
              <Field label="For"><Select value={edit.audience} onChange={(v) => setEdit({ ...edit, audience: v })} options={[{ value: 'ALL', label: 'Everyone' }, ...STAFF_TYPES]} /></Field>
              <Field label="Show until (optional)" htmlFor="an-e"><Input id="an-e" type="date" value={edit.expiresAt ?? ''} onChange={(e) => setEdit({ ...edit, expiresAt: e.target.value })} /></Field>
            </FormGrid>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5 }}><Switch checked={edit.pinned} onChange={(v) => setEdit({ ...edit, pinned: v })} label="Pin to top" /> Pin to the top</label>
            <ErrorLine error={act.error} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
              <Button onClick={() => setEdit(null)}>Cancel</Button>
              <Button variant="primary" loading={!!act.busy} onClick={() => act.run('s', () => hr(edit.id ? `/announcements/${edit.id}` : '/announcements', { method: edit.id ? 'PUT' : 'POST', body: { title: edit.title, body: edit.body, audience: edit.audience, pinned: edit.pinned, expiresAt: edit.expiresAt || null } }), () => { setEdit(null); r.reload() })}>Post</Button>
            </div>
          </>
        )}
      </Modal>
    </Section>
  )
}
