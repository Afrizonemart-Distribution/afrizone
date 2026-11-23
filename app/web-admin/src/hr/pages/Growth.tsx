/** Hiring for AZM roles, training records, anonymous pulse surveys. */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../../components/PageHeader'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Modal from '../../components/ui/Modal'
import Select from '../../components/ui/Select'
import Textarea from '../../components/ui/Textarea'
import { useApi } from '../../lib/useApi'
import { fileToBase64, hr, hrFile, niceDate, productLabel, STAFF_TYPES, typeLabel } from '../api'
import { useHr } from '../HrContext'
import { ErrorLine, Field, FormGrid, Load, Muted, Section, Status, Table, Tabs, Tag, useAction } from '../ui'
import type { DirPerson } from './People'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any

const STAGES = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN']
const stageLabel = (s: string) => s.charAt(0) + s.slice(1).toLowerCase()

// ── Hiring ──────────────────────────────────────────────────────────────────

export function HrHiring() {
  const openings = useApi((signal) => hr<Any[]>('/openings', { signal }), [])
  const [sel, setSel] = useState<Any | null>(null)
  const { can } = useHr()
  const act = useAction()
  const [edit, setEdit] = useState<Any | null>(null)
  return (
    <>
      <PageHeader crumb="AZM Staff · HR" title="Hiring" sub="Openings for AZM roles (not Partimers). When someone is hired, the product admin creates their account; you link it here and their file and joining checklist open." actions={can('hr.manage') && <Button variant="primary" icon="plus" onClick={() => setEdit({ title: '', department: '', product: '', staffType: 'FULL_TIME', description: '', status: 'OPEN' })}>New opening</Button>} />
      <ErrorLine error={act.error} />
      <Section pad={false} title="Openings">
        <Load r={openings}>
          {(rows) => (
            <Table
              rows={rows}
              rowKey={(o: Any) => o.id}
              onRow={setSel}
              empty="No openings yet"
              emptyIcon="briefcase"
              cols={[
                { label: 'Role', render: (o: Any) => <div><b style={{ color: sel?.id === o.id ? 'var(--navy)' : undefined }}>{o.title}</b><div style={{ fontSize: 12, color: 'var(--muted)' }}>{[o.department, o.product && productLabel(o.product), typeLabel(o.staffType)].filter(Boolean).join(' · ')}</div></div> },
                { label: 'Pipeline', render: (o: Any) => <Muted>{STAGES.filter((s) => o.stages[s]).map((s) => `${stageLabel(s)} ${o.stages[s]}`).join(' · ') || 'No candidates'}</Muted> },
                { label: 'Status', render: (o: Any) => <Status s={o.status} /> },
                { label: '', align: 'right', render: (o: Any) => (can('hr.manage') ? <Button size="sm" onClick={(e) => { e.stopPropagation(); setEdit({ ...o, department: o.department ?? '', product: o.product ?? '' }) }}>Edit</Button> : null) },
              ]}
            />
          )}
        </Load>
      </Section>
      {sel && <Candidates opening={sel} onChange={openings.reload} />}
      <Modal open={!!edit} title={edit?.id ? 'Edit opening' : 'New opening'} onClose={() => setEdit(null)} size="wide">
        {edit && (
          <>
            <FormGrid>
              <Field label="Job title" htmlFor="o-t"><Input id="o-t" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
              <Field label="Department" htmlFor="o-d"><Input id="o-d" value={edit.department} onChange={(e) => setEdit({ ...edit, department: e.target.value })} /></Field>
              <Field label="Product"><Select value={edit.product} onChange={(v) => setEdit({ ...edit, product: v })} options={[{ value: '', label: 'Company-wide' }, ...['STOREFRONT', 'SUPPLIER_OPS', 'INK', 'HUD', 'PARTTIME'].map((p) => ({ value: p, label: productLabel(p) }))]} /></Field>
              <Field label="Type"><Select value={edit.staffType} onChange={(v) => setEdit({ ...edit, staffType: v })} options={STAFF_TYPES} /></Field>
              <Field label="Status"><Select value={edit.status} onChange={(v) => setEdit({ ...edit, status: v })} options={[{ value: 'OPEN', label: 'Open' }, { value: 'PAUSED', label: 'Paused' }, { value: 'CLOSED', label: 'Closed' }]} /></Field>
            </FormGrid>
            <Field label="Job description" htmlFor="o-desc"><Textarea id="o-desc" rows={10} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <ErrorLine error={act.error} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Button onClick={() => setEdit(null)}>Cancel</Button>
              <Button variant="primary" loading={!!act.busy} onClick={() => act.run('s', () => hr(edit.id ? `/openings/${edit.id}` : '/openings', { method: edit.id ? 'PUT' : 'POST', body: { title: edit.title, department: edit.department || null, product: edit.product || null, staffType: edit.staffType, description: edit.description, status: edit.status } }), () => { setEdit(null); openings.reload() })}>Save</Button>
            </div>
          </>
        )}
      </Modal>
    </>
  )
}

function Candidates({ opening, onChange }: { opening: Any; onChange: () => void }) {
  const r = useApi((signal) => hr<Any[]>(`/openings/${opening.id}/candidates`, { signal }), [opening.id])
  const people = useApi((signal) => hr<DirPerson[]>('/directory', { signal }), [])
  const { can } = useHr()
  const act = useAction()
  const [add, setAdd] = useState<Any | null>(null)
  const [open, setOpen] = useState<Any | null>(null)
  const [note, setNote] = useState('')
  const [link, setLink] = useState('')
  const reload = () => { r.reload(); onChange() }
  return (
    <Section pad={false} title={`Candidates · ${opening.title}`} actions={can('hr.manage') && <Button variant="primary" icon="plus" onClick={() => setAdd({ name: '', email: '', phone: '', source: '' })}>Add candidate</Button>}>
      <ErrorLine error={act.error} />
      <Load r={r}>
        {(rows) => (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(210px, 100%), 1fr))', gap: 10, padding: 16 }}>
            {STAGES.filter((s) => s !== 'WITHDRAWN').map((s) => (
              <div key={s} style={{ background: 'var(--glass)', borderRadius: 12, padding: 10, minHeight: 80 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>{stageLabel(s)} · {rows.filter((c) => c.stage === s).length}</div>
                {rows.filter((c) => c.stage === s).map((c) => (
                  <button key={c.id} onClick={() => { setOpen(c); setNote(''); setLink('') }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px', marginBottom: 6, cursor: 'pointer' }}>
                    <b style={{ fontSize: 13.5 }}>{c.name}</b>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.interviewAt ? `Interview ${niceDate(c.interviewAt)}` : c.source ?? c.email}</div>
                    {c.rating && <div style={{ fontSize: 12 }}>{'★'.repeat(c.rating)}</div>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </Load>
      <Modal open={!!add} title="Add candidate" onClose={() => setAdd(null)}>
        {add && (
          <>
            <FormGrid>
              <Field label="Name" htmlFor="c-n"><Input id="c-n" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></Field>
              <Field label="Email" htmlFor="c-e"><Input id="c-e" type="email" value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} /></Field>
              <Field label="Phone" htmlFor="c-p"><Input id="c-p" value={add.phone} onChange={(e) => setAdd({ ...add, phone: e.target.value })} /></Field>
              <Field label="Source" htmlFor="c-s"><Input id="c-s" value={add.source} onChange={(e) => setAdd({ ...add, source: e.target.value })} placeholder="Referral, LinkedIn, jobs@" /></Field>
            </FormGrid>
            <ErrorLine error={act.error} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Button onClick={() => setAdd(null)}>Cancel</Button>
              <Button variant="primary" loading={!!act.busy} onClick={() => act.run('a', () => hr(`/openings/${opening.id}/candidates`, { method: 'POST', body: { name: add.name, email: add.email, phone: add.phone || null, source: add.source || null } }), () => { setAdd(null); reload() })}>Add</Button>
            </div>
          </>
        )}
      </Modal>
      <Modal open={!!open} title={open?.name ?? ''} subtitle={open ? `${open.email}${open.phone ? ` · ${open.phone}` : ''}` : ''} onClose={() => setOpen(null)} size="wide">
        {open && (
          <>
            <FormGrid>
              <Field label="Stage"><Select value={open.stage} onChange={(v) => act.run('st', () => hr(`/candidates/${open.id}`, { method: 'PUT', body: { stage: v } }), () => { setOpen({ ...open, stage: v }); reload() })} options={STAGES.map((s) => ({ value: s, label: stageLabel(s) }))} disabled={!can('hr.manage')} /></Field>
              <Field label="Interview" htmlFor="c-i"><Input id="c-i" type="datetime-local" defaultValue={open.interviewAt ? open.interviewAt.slice(0, 16) : ''} onBlur={(e) => e.target.value && act.run('iv', () => hr(`/candidates/${open.id}`, { method: 'PUT', body: { interviewAt: new Date(e.target.value).toISOString() } }), reload)} disabled={!can('hr.manage')} /></Field>
              <Field label="Rating"><Select value={String(open.rating ?? '')} onChange={(v) => act.run('rt', () => hr(`/candidates/${open.id}`, { method: 'PUT', body: { rating: v ? Number(v) : null } }), () => { setOpen({ ...open, rating: Number(v) }); reload() })} options={[{ value: '', label: 'Not rated' }, ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: '★'.repeat(n) }))]} disabled={!can('hr.manage')} /></Field>
              <Field label="CV">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {open.cvDocId && <Button size="sm" icon="eye" onClick={() => act.run('cv', () => hrFile(`/documents/${open.cvDocId}/file`))}>Open CV</Button>}
                  {can('hr.manage') && <input type="file" accept=".pdf,.docx" aria-label="Upload CV" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; await act.run('up', async () => { const res = await hr<Any>(`/candidates/${open.id}/cv`, { method: 'POST', body: { title: `CV · ${open.name}`, contentType: f.type, dataBase64: await fileToBase64(f) } }); setOpen({ ...open, cvDocId: res.id }) }, reload) }} />}
                </div>
              </Field>
            </FormGrid>
            <Section title="Notes">
              {open.notes.length === 0 ? <Muted>No notes yet.</Muted> : open.notes.map((n: Any, i: number) => <div key={i} style={{ fontSize: 13.5, marginBottom: 6 }}><Muted>{niceDate(n.at)} · {n.byName ?? 'HR'}:</Muted> {n.text}</div>)}
              {can('hr.manage') && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <Input aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Interview feedback, reference check…" />
                  <Button disabled={!note.trim()} onClick={() => act.run('n', () => hr(`/candidates/${open.id}`, { method: 'PUT', body: { note } }), () => { setOpen({ ...open, notes: [...open.notes, { at: new Date().toISOString(), text: note, byName: 'You' }] }); setNote(''); reload() })}>Add</Button>
                </div>
              )}
            </Section>
            {open.stage === 'HIRED' && can('hr.manage') && (
              <Section title="Link their account" sub="Once the product admin has created their staff account, pick it here. This opens their HR file and joining checklist.">
                {open.hiredUserId ? (
                  <Link to={`/hr/people/${open.hiredUserId}`} className="btn btn-glass btn-sm">Open their file</Link>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}><Select value={link} onChange={setLink} options={(people.data ?? []).map((p) => ({ value: p.userId, label: `${p.name ?? p.email} (${p.email})` }))} placeholder="Pick the new account" /></div>
                    <Button variant="primary" disabled={!link} onClick={() => act.run('l', () => hr(`/candidates/${open.id}/link`, { method: 'POST', body: { userId: link } }), () => { setOpen({ ...open, hiredUserId: link }); reload() })}>Link</Button>
                  </div>
                )}
              </Section>
            )}
            <ErrorLine error={act.error} />
          </>
        )}
      </Modal>
    </Section>
  )
}

// ── Training ────────────────────────────────────────────────────────────────

export function HrTraining() {
  const r = useApi((signal) => hr<Any[]>('/training', { signal }), [])
  const people = useApi((signal) => hr<DirPerson[]>('/directory', { signal }), [])
  const { can } = useHr()
  const act = useAction()
  const [assign, setAssign] = useState<Any | null>(null)
  const [tab, setTab] = useState<'todo' | 'done'>('todo')
  return (
    <>
      <PageHeader crumb="AZM Staff · HR" title="Training" sub="Courses assigned to people, with due dates and certificates. Staff mark their own as done in My HR and attach the certificate." actions={can('hr.manage') && <Button variant="primary" icon="plus" onClick={() => setAssign({ userIds: [] as string[], title: '', provider: '', url: '', dueAt: '' })}>Assign training</Button>} />
      <ErrorLine error={act.error} />
      <Load r={r}>
        {(rows) => (
          <>
            <Tabs value={tab} onChange={setTab} tabs={[{ value: 'todo', label: 'To do', count: rows.filter((t) => t.status !== 'DONE').length }, { value: 'done', label: 'Done', count: rows.filter((t) => t.status === 'DONE').length }]} />
            <Section pad={false}>
              <Table
                rows={rows.filter((t) => (tab === 'done' ? t.status === 'DONE' : t.status !== 'DONE'))}
                rowKey={(t: Any) => t.id}
                empty="Nothing here"
                cols={[
                  { label: 'Person', render: (t: Any) => <Link to={`/hr/people/${t.userId}`} style={{ fontWeight: 700 }}>{t.name}</Link> },
                  { label: 'Course', render: (t: Any) => <div>{t.url ? <a href={t.url} target="_blank" rel="noreferrer">{t.title}</a> : t.title}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{t.provider ?? ''}</div></div> },
                  { label: tab === 'done' ? 'Done' : 'Due', render: (t: Any) => (tab === 'done' ? niceDate(t.completedAt) : t.overdue ? <Tag tone="bad">Overdue {niceDate(t.dueAt)}</Tag> : niceDate(t.dueAt)) },
                  { label: 'Certificate', render: (t: Any) => (t.certDocId ? <Button size="sm" icon="eye" onClick={() => act.run('c' + t.id, () => hrFile(`/documents/${t.certDocId}/file`))}>Open</Button> : <Muted>—</Muted>) },
                  { label: 'Expires', render: (t: Any) => niceDate(t.expiresAt) },
                  { label: '', align: 'right', render: (t: Any) => (can('hr.manage') ? <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>{t.status !== 'DONE' && <Button size="sm" onClick={() => act.run('d' + t.id, () => hr(`/training/${t.id}/complete`, { method: 'POST', body: {} }), r.reload)}>Mark done</Button>}<Button size="sm" variant="danger" onClick={() => confirm('Remove this training record?') && act.run('x' + t.id, () => hr(`/training/${t.id}`, { method: 'DELETE' }), r.reload)}>Remove</Button></div> : null) },
                ]}
              />
            </Section>
          </>
        )}
      </Load>
      <Modal open={!!assign} title="Assign training" onClose={() => setAssign(null)} size="wide">
        {assign && (
          <>
            <FormGrid>
              <Field label="Course" htmlFor="tr-t"><Input id="tr-t" value={assign.title} onChange={(e) => setAssign({ ...assign, title: e.target.value })} placeholder="e.g. Data protection (NDPA) basics" /></Field>
              <Field label="Provider" htmlFor="tr-p"><Input id="tr-p" value={assign.provider} onChange={(e) => setAssign({ ...assign, provider: e.target.value })} /></Field>
              <Field label="Link" htmlFor="tr-u"><Input id="tr-u" value={assign.url} onChange={(e) => setAssign({ ...assign, url: e.target.value })} placeholder="https://" /></Field>
              <Field label="Due" htmlFor="tr-d"><Input id="tr-d" type="date" value={assign.dueAt} onChange={(e) => setAssign({ ...assign, dueAt: e.target.value })} /></Field>
            </FormGrid>
            <Field label={`People (${assign.userIds.length})`}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <Button size="sm" onClick={() => setAssign({ ...assign, userIds: (people.data ?? []).map((p) => p.userId) })}>Everyone</Button>
                <Button size="sm" onClick={() => setAssign({ ...assign, userIds: (people.data ?? []).filter((p) => p.staffType === 'INTERN').map((p) => p.userId) })}>All interns</Button>
                <Button size="sm" onClick={() => setAssign({ ...assign, userIds: [] })}>Clear</Button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6, maxHeight: 220, overflow: 'auto' }}>
                {(people.data ?? []).map((p) => (
                  <label key={p.userId} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                    <input type="checkbox" checked={assign.userIds.includes(p.userId)} onChange={(e) => setAssign({ ...assign, userIds: e.target.checked ? [...assign.userIds, p.userId] : assign.userIds.filter((x: string) => x !== p.userId) })} />
                    {p.name ?? p.email}
                  </label>
                ))}
              </div>
            </Field>
            <ErrorLine error={act.error} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Button onClick={() => setAssign(null)}>Cancel</Button>
              <Button variant="primary" loading={!!act.busy} disabled={!assign.title || assign.userIds.length === 0} onClick={() => act.run('a', () => hr('/training', { method: 'POST', body: { userIds: assign.userIds, title: assign.title, provider: assign.provider || null, url: assign.url || null, dueAt: assign.dueAt || null } }), () => { setAssign(null); r.reload() })}>Assign</Button>
            </div>
          </>
        )}
      </Modal>
    </>
  )
}

// ── Surveys ─────────────────────────────────────────────────────────────────

export function HrSurveys() {
  const r = useApi((signal) => hr<Any[]>('/surveys', { signal }), [])
  const { can } = useHr()
  const act = useAction()
  const [create, setCreate] = useState<Any | null>(null)
  const [results, setResults] = useState<Any | null>(null)
  const blank = { title: '', audience: 'ALL', closesAt: '', questions: [{ key: 'q1', text: 'How happy are you at work this month?', type: 'SCALE' }, { key: 'q2', text: 'What one thing would make your work better?', type: 'TEXT' }] }
  return (
    <>
      <PageHeader crumb="AZM Staff · HR" title="Pulse surveys" sub="Short anonymous check-ins. Answers are stored without names, and results stay hidden until at least 3 people have answered." actions={can('hr.manage') && <Button variant="primary" icon="plus" onClick={() => setCreate(JSON.parse(JSON.stringify(blank)))}>New survey</Button>} />
      <ErrorLine error={act.error} />
      <Section pad={false}>
        <Load r={r}>
          {(rows) => (
            <Table
              rows={rows}
              rowKey={(s: Any) => s.id}
              empty="No surveys yet"
              cols={[
                { label: 'Survey', render: (s: Any) => <b>{s.title}</b> },
                { label: 'For', render: (s: Any) => (s.audience === 'ALL' ? 'Everyone' : typeLabel(s.audience)) },
                { label: 'Answers', render: (s: Any) => s.responses, align: 'right' },
                { label: 'Status', render: (s: Any) => (s.open ? <Tag tone="ok">Open{s.closesAt ? ` until ${niceDate(s.closesAt)}` : ''}</Tag> : <Tag>Closed</Tag>) },
                { label: '', align: 'right', render: (s: Any) => <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}><Button size="sm" onClick={() => hr<Any>(`/surveys/${s.id}/results`).then(setResults)}>Results</Button>{can('hr.manage') && s.open && <Button size="sm" onClick={() => act.run('c' + s.id, () => hr(`/surveys/${s.id}/close`, { method: 'POST' }), r.reload)}>Close</Button>}</div> },
              ]}
            />
          )}
        </Load>
      </Section>
      <Modal open={!!create} title="New pulse survey" onClose={() => setCreate(null)} size="wide">
        {create && (
          <>
            <FormGrid>
              <Field label="Title" htmlFor="sv-t"><Input id="sv-t" value={create.title} onChange={(e) => setCreate({ ...create, title: e.target.value })} placeholder="November pulse" /></Field>
              <Field label="For"><Select value={create.audience} onChange={(v) => setCreate({ ...create, audience: v })} options={[{ value: 'ALL', label: 'Everyone' }, ...STAFF_TYPES]} /></Field>
              <Field label="Closes (optional)" htmlFor="sv-c"><Input id="sv-c" type="date" value={create.closesAt} onChange={(e) => setCreate({ ...create, closesAt: e.target.value })} /></Field>
            </FormGrid>
            <Field label="Questions">
              {create.questions.map((q: Any, i: number) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 150px 40px', gap: 8, marginBottom: 8 }}>
                  <Input aria-label="Question" value={q.text} onChange={(e) => setCreate({ ...create, questions: create.questions.map((x: Any, j: number) => (j === i ? { ...x, text: e.target.value } : x)) })} />
                  <Select value={q.type} onChange={(v) => setCreate({ ...create, questions: create.questions.map((x: Any, j: number) => (j === i ? { ...x, type: v } : x)) })} options={[{ value: 'SCALE', label: 'Scale 1–5' }, { value: 'TEXT', label: 'Written answer' }]} />
                  <Button size="sm" variant="danger" aria-label="Remove" onClick={() => setCreate({ ...create, questions: create.questions.filter((_: Any, j: number) => j !== i) })}>×</Button>
                </div>
              ))}
              <Button size="sm" icon="plus" onClick={() => setCreate({ ...create, questions: [...create.questions, { key: `q${Date.now() % 100000}`, text: '', type: 'SCALE' }] })}>Add question</Button>
            </Field>
            <ErrorLine error={act.error} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Button onClick={() => setCreate(null)}>Cancel</Button>
              <Button variant="primary" loading={!!act.busy} disabled={!create.title || create.questions.length === 0} onClick={() => act.run('s', () => hr('/surveys', { method: 'POST', body: { title: create.title, audience: create.audience, closesAt: create.closesAt || null, questions: create.questions.filter((q: Any) => q.text).map((q: Any, i: number) => ({ key: `q${i + 1}`, text: q.text, type: q.type })) } }), () => { setCreate(null); r.reload() })}>Send survey</Button>
            </div>
          </>
        )}
      </Modal>
      <Modal open={!!results} title={results?.survey.title ?? ''} subtitle={results ? `${results.responses} answer(s)` : ''} onClose={() => setResults(null)} size="wide">
        {results?.hidden ? (
          <Muted>Results show once at least 3 people have answered, so nobody can be singled out.</Muted>
        ) : (
          results?.results.map((q: Any) => (
            <Section key={q.key} title={q.text} sub={`${q.answered} answered`}>
              {q.type === 'SCALE' ? (
                <div>
                  <div style={{ fontSize: 24, fontWeight: 800 }}>{q.average ?? '—'} <Muted>/ 5</Muted></div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 60, marginTop: 8 }}>
                    {q.distribution.map((n: number, i: number) => {
                      const max = Math.max(1, ...q.distribution)
                      return <div key={i} title={`${i + 1}: ${n}`} style={{ flex: 1, textAlign: 'center', fontSize: 11 }}><div style={{ height: (n / max) * 44, background: 'var(--navy)', borderRadius: 4 }} />{i + 1}</div>
                    })}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 6 }}>{q.texts.map((t: string, i: number) => <div key={i} style={{ fontSize: 13.5, borderLeft: '3px solid var(--line)', paddingLeft: 8 }}>{t}</div>)}</div>
              )}
            </Section>
          ))
        )}
      </Modal>
    </>
  )
}
