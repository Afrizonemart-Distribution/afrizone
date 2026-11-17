import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import Logo from '../components/Logo'
import { ErrorNote } from './Shell'
import {
  clearStaffToken,
  getStaffToken,
  staffApi,
  staffSignIn,
  type Scorecard,
  type StaffMe,
  type StaffTask,
  type TeamRow,
} from '../lib/staff'
import './Shell.css'
import './Staff.css'

/**
 * The staff workspace: an AfriZone staff member's tasks from every product
 * admin, their review queue if they manage people, offsite work, and KPI.
 * Tasks are created in the product admins, never here.
 */

const PRODUCT_LABEL: Record<string, string> = { STOREFRONT: 'Storefront', INK: 'Ink', SUPPLIER_OPS: 'Supplier Ops' }
const STATUS_LABEL: Record<string, string> = {
  OPEN: 'To do',
  IN_PROGRESS: 'In progress',
  SUBMITTED: 'Waiting for review',
  REWORK: 'Sent back',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
}
const PILLAR_LABEL: Record<string, string> = {
  delivery: 'On-time delivery',
  output: 'Output',
  quality: 'Quality',
  presence: 'Presence',
}

type Tab = 'tasks' | 'review' | 'kpi' | 'team'

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

export default function StaffWorkspace() {
  const [me, setMe] = useState<StaffMe | null>(null)
  const [checking, setChecking] = useState(!!getStaffToken())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('tasks')

  useEffect(() => {
    if (!getStaffToken()) return
    staffApi
      .me()
      .then(setMe)
      .catch(() => clearStaffToken())
      .finally(() => setChecking(false))
  }, [])

  // Not async: the AfriZone popup must open in the click's own tick.
  function signIn() {
    setBusy(true)
    setError(null)
    staffSignIn()
      .then(setMe)
      .catch((e) => setError(errText(e, 'Could not sign you in')))
      .finally(() => setBusy(false))
  }

  function signOut() {
    clearStaffToken()
    setMe(null)
  }

  const reviews = !!me && (me.manages > 0 || me.monitor)

  return (
    <div className="sh">
      <header className="sh-top">
        <Link className="sh-brand" to="/">
          <Logo size={30} />
        </Link>
        {me && (
          <div className="sh-who">
            <span className="sh-me">
              <b>{me.name ?? me.email}</b>
              <span>{me.jobTitle ?? 'AfriZone staff'}</span>
            </span>
            <button className="btn ghost inline sm" onClick={signOut}>
              Sign out
            </button>
          </div>
        )}
      </header>
      <div className="sh-body">
        {checking ? (
          <p className="lede">Loading…</p>
        ) : !me ? (
          <div className="form-narrow">
            <p className="eyebrow">AfriZone staff</p>
            <h1 className="pt">Your work, in one place</h1>
            <p className="lede">
              Tasks from the Storefront, Ink and Supplier Ops admins, your review queue, offsite work and your KPI.
            </p>
            <div className="card">
              {error && <ErrorNote message={error} />}
              <button className="btn" type="button" onClick={signIn} disabled={busy}>
                {busy ? 'Waiting for AfriZone…' : 'Sign in with your AfriZone staff account'}
              </button>
              <p className="hint afz-hint">The same account and two-step sign-in you use for the admin.</p>
            </div>
          </div>
        ) : (
          <>
            <p className="eyebrow">AfriZone staff</p>
            <h1 className="pt">Hello, {(me.name ?? '').split(' ')[0] || 'there'}</h1>
            <nav className="st-tabs" aria-label="Staff workspace">
              <TabButton id="tasks" tab={tab} setTab={setTab} label="My tasks" />
              {reviews && <TabButton id="review" tab={tab} setTab={setTab} label="To review" />}
              <TabButton id="kpi" tab={tab} setTab={setTab} label="My KPI" />
              {reviews && <TabButton id="team" tab={tab} setTab={setTab} label={me.monitor ? 'Everyone' : 'My team'} />}
            </nav>
            {tab === 'tasks' && <TaskList scope="mine" />}
            {tab === 'review' && <TaskList scope="review" />}
            {tab === 'kpi' && <MyKpi />}
            {tab === 'team' && <TeamKpi monitor={me.monitor} />}
          </>
        )}
      </div>
    </div>
  )
}

function TabButton({ id, tab, setTab, label }: { id: Tab; tab: Tab; setTab: (t: Tab) => void; label: string }) {
  return (
    <button type="button" className={`st-tab${tab === id ? ' on' : ''}`} aria-pressed={tab === id} onClick={() => setTab(id)}>
      {label}
    </button>
  )
}

/* ─────────────────────────── Tasks ─────────────────────────── */

function TaskList({ scope }: { scope: 'mine' | 'review' }) {
  const [items, setItems] = useState<StaffTask[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [offsite, setOffsite] = useState(false)

  const load = useCallback(() => {
    setError(null)
    const status = scope === 'review' ? undefined : showDone ? undefined : 'OPEN,IN_PROGRESS,SUBMITTED,REWORK'
    staffApi
      .tasks(scope, status)
      .then((r) => setItems(r.items))
      .catch((e) => setError(errText(e, 'Could not load tasks')))
  }, [scope, showDone])

  useEffect(() => {
    setItems(null)
    load()
  }, [load])

  return (
    <div>
      {scope === 'mine' && (
        <div className="st-bar">
          <label className="st-check">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show finished
          </label>
          <button className="btn ghost inline sm" onClick={() => setOffsite((v) => !v)}>
            {offsite ? 'Close' : 'Log offsite work'}
          </button>
        </div>
      )}
      {offsite && (
        <OffsiteForm
          onDone={() => {
            setOffsite(false)
            load()
          }}
        />
      )}
      {error && <ErrorNote message={error} />}
      {!items ? (
        <p className="lede">Loading…</p>
      ) : items.length === 0 ? (
        <div className="card">
          <p className="st-empty">{scope === 'review' ? 'Nothing waiting for your review.' : 'No tasks right now.'}</p>
        </div>
      ) : (
        items.map((t) => <TaskCard key={t.id} task={t} review={scope === 'review'} onChanged={load} />)
      )}
    </div>
  )
}

function TaskCard({ task, review, onChanged }: { task: StaffTask; review: boolean; onChanged: () => void }) {
  const [mode, setMode] = useState<'none' | 'submit' | 'approve' | 'rework'>('none')
  const [note, setNote] = useState('')
  const [score, setScore] = useState(4)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const p = task.permissions

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setMode('none')
      setNote('')
      onChanged()
    } catch (e) {
      setError(errText(e, 'That didn’t work'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card st-task">
      <div className="st-task-head">
        <div>
          <b className="st-title">{task.title}</b>
          <div className="st-meta">
            {PRODUCT_LABEL[task.product] ?? task.product}
            {task.kind === 'OFFSITE' && ' · Offsite'}
            {review && ` · ${task.assignee.name ?? task.assignee.email}`}
            {task.dueAt && ` · due ${new Date(task.dueAt).toLocaleDateString()}`}
          </div>
        </div>
        <span className={`st-pill${task.overdue ? ' late' : task.status === 'DONE' ? ' done' : ''}`}>
          {task.overdue ? 'Overdue' : STATUS_LABEL[task.status] ?? task.status}
        </span>
      </div>
      {task.description && <p className="st-desc">{task.description}</p>}
      {task.completion === 'AUTO' && task.autoTarget ? (
        <p className="st-meta">
          Finishes itself: {task.autoProgress ?? 0} of {task.autoTarget}
        </p>
      ) : null}
      {error && <ErrorNote message={error} />}

      {mode === 'none' && (
        <div className="st-actions">
          {p.canStart && (
            <button className="btn ghost inline sm" disabled={busy} onClick={() => run(() => staffApi.start(task.id))}>
              Start
            </button>
          )}
          {p.canSubmit && task.completion !== 'AUTO' && (
            <button className="btn inline sm" disabled={busy} onClick={() => setMode('submit')}>
              Mark done
            </button>
          )}
          {p.canApprove && (
            <button className="btn inline sm" disabled={busy} onClick={() => setMode('approve')}>
              Approve
            </button>
          )}
          {p.canRework && (
            <button className="btn ghost inline sm" disabled={busy} onClick={() => setMode('rework')}>
              Send back
            </button>
          )}
        </div>
      )}

      {mode !== 'none' && (
        <div className="st-form">
          {mode === 'approve' && (
            <div className="field">
              <label htmlFor={`q-${task.id}`}>How good was the work? (1 poor – 5 excellent)</label>
              <select id={`q-${task.id}`} value={score} onChange={(e) => setScore(Number(e.target.value))}>
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor={`n-${task.id}`}>
              {mode === 'rework' ? 'What needs fixing?' : mode === 'submit' ? 'Note for your manager (optional)' : 'Note (optional)'}
            </label>
            <input id={`n-${task.id}`} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="st-actions">
            <button className="btn ghost inline sm" onClick={() => setMode('none')} disabled={busy}>
              Cancel
            </button>
            <button
              className="btn inline sm"
              disabled={busy || (mode === 'rework' && note.trim().length < 3)}
              onClick={() =>
                run(() =>
                  mode === 'submit'
                    ? staffApi.submit(task.id, note.trim() || undefined)
                    : mode === 'approve'
                      ? staffApi.approve(task.id, score, note.trim() || undefined)
                      : staffApi.rework(task.id, note.trim()),
                )
              }
            >
              {busy ? 'Saving…' : mode === 'submit' ? 'Submit' : mode === 'approve' ? 'Approve' : 'Send back'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Lagos is UTC+1 all year. */
const toLagosIso = (date: string, time: string) => `${date}T${time}:00+01:00`

function OffsiteForm({ onDone }: { onDone: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const [product, setProduct] = useState('STOREFRONT')
  const [title, setTitle] = useState('')
  const [location, setLocation] = useState('')
  const [date, setDate] = useState(today)
  const [from, setFrom] = useState('09:00')
  const [to, setTo] = useState('17:00')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = title.trim().length >= 3 && location.trim().length >= 2 && from < to

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      await staffApi.logOffsite({
        product,
        title: title.trim(),
        location: location.trim(),
        startAt: toLagosIso(date, from),
        endAt: toLagosIso(date, to),
      })
      onDone()
    } catch (err) {
      setError(errText(err, 'Could not log it'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <p className="st-meta" style={{ marginTop: 0 }}>
        Work away from your desk (a supplier visit, an event). Your manager approves it, then the hours count.
      </p>
      {error && <ErrorNote message={error} />}
      <div className="st-grid">
        <div className="field">
          <label htmlFor="o-title">What was it?</label>
          <input id="o-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Supplier visit, Ikeja" />
        </div>
        <div className="field">
          <label htmlFor="o-loc">Where</label>
          <input id="o-loc" value={location} maxLength={200} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="o-prod">For</label>
          <select id="o-prod" value={product} onChange={(e) => setProduct(e.target.value)}>
            {Object.entries(PRODUCT_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="o-date">Day</label>
          <input id="o-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="o-from">From</label>
          <input id="o-from" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="o-to">To</label>
          <input id="o-to" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <button className="btn inline" type="submit" disabled={busy || !valid}>
        {busy ? 'Saving…' : 'Log offsite work'}
      </button>
    </form>
  )
}

/* ─────────────────────────── KPI ─────────────────────────── */

function PeriodSwitch({ period, setPeriod }: { period: 'week' | 'month'; setPeriod: (p: 'week' | 'month') => void }) {
  return (
    <div className="st-bar">
      <div className="st-seg" role="group" aria-label="Period">
        {(['week', 'month'] as const).map((p) => (
          <button key={p} type="button" className={period === p ? 'on' : ''} aria-pressed={period === p} onClick={() => setPeriod(p)}>
            This {p}
          </button>
        ))}
      </div>
    </div>
  )
}

const scoreText = (n: number | null) => (n == null ? '—' : `${Math.round(n)}`)
const tone = (n: number | null) => (n == null ? '' : n >= 75 ? ' good' : n >= 50 ? ' mid' : ' low')

function MyKpi() {
  const [period, setPeriod] = useState<'week' | 'month'>('week')
  const [card, setCard] = useState<Scorecard | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setCard(null)
    setError(null)
    staffApi
      .myKpi(period)
      .then(setCard)
      .catch((e) => setError(errText(e, 'Could not load your KPI')))
  }, [period])

  return (
    <div>
      <PeriodSwitch period={period} setPeriod={setPeriod} />
      {error && <ErrorNote message={error} />}
      {!card ? (
        !error && <p className="lede">Loading…</p>
      ) : (
        <>
          <div className="card st-score">
            <span className={`st-big${tone(card.score)}`}>{scoreText(card.score)}</span>
            <div>
              <b>{card.kind === 'INTERN' ? 'Approval rate' : 'KPI score'}</b>
              <div className="st-meta">
                {card.score == null ? 'Not enough to score yet this ' + period : `out of 100, this ${period}`}
              </div>
            </div>
          </div>
          {card.flags.length > 0 && (
            <div className="card">
              {card.flags.map((f) => (
                <p key={f} className="st-flag">
                  {f}
                </p>
              ))}
            </div>
          )}
          {card.staff && (
            <div className="st-pillars">
              {Object.entries(card.staff.pillars).map(([k, p]) => (
                <div key={k} className="card">
                  <div className="st-meta">{PILLAR_LABEL[k] ?? k}</div>
                  <span className={`st-mid${tone(p.score)}`}>{scoreText(p.score)}</span>
                  <div className="st-meta">{p.weight > 0 ? `${p.weight}% of the score` : 'Not counted yet'}</div>
                </div>
              ))}
            </div>
          )}
          {card.intern && (
            <div className="st-pillars">
              <div className="card">
                <div className="st-meta">Approved</div>
                <span className="st-mid">{card.intern.deliverables.approved}</span>
                <div className="st-meta">
                  {card.intern.deliverables.trend >= 0 ? '+' : ''}
                  {card.intern.deliverables.trend} on last {period}
                </div>
              </div>
              <div className="card">
                <div className="st-meta">Submitted</div>
                <span className="st-mid">{card.intern.deliverables.submitted}</span>
              </div>
              <div className="card">
                <div className="st-meta">Sent back</div>
                <span className="st-mid">{card.intern.deliverables.rejected}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function TeamKpi({ monitor }: { monitor: boolean }) {
  const [period, setPeriod] = useState<'week' | 'month'>('week')
  const [rows, setRows] = useState<TeamRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setRows(null)
    setError(null)
    staffApi
      .teamKpi(period, monitor ? 'all' : 'team')
      .then((r) => setRows(r.items))
      .catch((e) => setError(errText(e, 'Could not load the team')))
  }, [period, monitor])

  return (
    <div>
      <PeriodSwitch period={period} setPeriod={setPeriod} />
      {error && <ErrorNote message={error} />}
      {!rows ? (
        !error && <p className="lede">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card">
          <p className="st-empty">Nobody reports to you yet.</p>
        </div>
      ) : (
        <div className="card st-team">
          {rows.map((r) => (
            <div key={r.person.id} className="st-row">
              <div>
                <b>{r.person.name ?? r.person.email}</b>
                <div className="st-meta">
                  {r.person.jobTitle ?? (r.kind === 'INTERN' ? 'Intern' : 'Staff')}
                  {r.overdueOpen > 0 && ` · ${r.overdueOpen} overdue`}
                  {r.flags.length > 0 && ` · ${r.flags.join(' · ')}`}
                </div>
              </div>
              <span className={`st-mid${tone(r.score)}`}>{scoreText(r.score)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
