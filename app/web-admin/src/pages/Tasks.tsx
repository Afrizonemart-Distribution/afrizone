import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useApi } from '../lib/useApi'
import EvidenceButton from '../components/EvidenceButton'
import {
  TIER_COLORS,
  TIER_LABELS,
  formatDate,
  taskPay,
  taskPill,
} from '../lib/format'
import type {
  CreateTaskBody,
  CredentialType,
  LocationType,
  PayModel,
  QualifyingCount,
  Skill,
  Task,
  TaskQuestion,
  TaskTemplate,
  Tier,
} from '../api/types'
import QuestionsEditor from '../components/QuestionsEditor'
import Switch from '../components/ui/Switch'
import PageHeader from '../components/PageHeader'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import StatusPill from '../components/ui/StatusPill'
import Icon from '../components/Icon'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateView'
import './Tasks.css'
import Input from '../components/ui/Input'
import Textarea from '../components/ui/Textarea'
import Select from '../components/ui/Select'
import { Label } from '@/components/shadcn/label'
import { Progress } from '@/components/shadcn/progress'
import { Badge } from '@/components/shadcn/badge'

const TIERS: Tier[] = ['STUDENT', 'DISPATCH', 'REMOTE', 'PROMO', 'TRADE']

function TaskCard({ task, delay }: { task: Task; delay: string }) {
  const filled = task.filledCount ?? 0
  const pct = task.slots > 0 ? Math.min(100, Math.round((filled / task.slots) * 100)) : 0
  const pill = taskPill(task.status)
  const [w, setW] = useState(0)
  useEffect(() => {
    const id = setTimeout(() => setW(pct), 200)
    return () => clearTimeout(id)
  }, [pct])

  function onMove(e: PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`)
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`)
  }

  return (
    <div className={`glass tcard rv in ${delay}`} onPointerMove={onMove}>
      <div className="tc-top">
        <Badge variant="outline" className="tier">
          <span className="d" style={{ background: TIER_COLORS[task.tier] }} />
          {TIER_LABELS[task.tier]}
        </Badge>
        <span className="pay">{taskPay(task.rate, task.budget, task.payModel, task.unitLabel)}</span>
      </div>
      <h4>{task.title}</h4>
      <div className="mrow">
        <span>
          <Icon name={task.locationType === 'REMOTE' ? 'help' : 'pin'} />
          {task.locationType === 'REMOTE'
            ? 'Remote · nationwide'
            : task.address || 'On-site'}
        </span>
        <span>
          <Icon name="calendar" />
          {formatDate(task.startDate)} → {formatDate(task.endDate)}
        </span>
        <span>
          <Icon name="users" />
          {task.applicantCount ?? 0} applicants
        </span>
      </div>
      {/* Radix Progress carries role="progressbar" with aria-valuenow/min/max,
          which the bare div pair did not: a screen reader had no way to read the
          fill level at all. */}
      <Progress
        value={w}
        className="fillbar"
        aria-label={`${filled} of ${task.slots} slots filled`}
      />
      {task.requirementsSummary ? (
        <div className="tc-reqs" title={task.requirementsSummary}>
          <Icon name="shield" size={12} />
          <span>{task.requirementsSummary}</span>
        </div>
      ) : null}
      <div className="tc-foot">
        <span>
          {filled} of {task.slots} filled
        </span>
        {/* Store audits have no screen of their own yet, so this is where
            their photos are reviewed - along with every other job's. */}
        {filled > 0 && <EvidenceButton taskId={task.id} />}
        <StatusPill variant={pill.variant} label={pill.label} />
      </div>
    </div>
  )
}

/**
 * How many workers could actually take this task, refreshed as the form is
 * edited.
 *
 * This panel is the whole reason requirements are a separate step rather than
 * four more fields in the details form. An admin adding "Forklift Ticket"
 * without it finds out what it cost a week later, as an applicant list that
 * never filled; here they see the pool drop from 38 to 3 while their finger is
 * still on the toggle, and which line did it.
 */
function QualifyingPanel({
  tier,
  requiresIdentityVerified,
  skillIds,
  credentialTypeIds,
}: {
  tier: Tier
  requiresIdentityVerified: boolean
  skillIds: string[]
  credentialTypeIds: string[]
}) {
  const [count, setCount] = useState<QualifyingCount | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Keeps the LAST result on screen while the next one is in flight. Blanking
  // the number on every keystroke makes the panel flicker, and a flickering
  // number is one nobody reads.
  const seen = useRef(false)

  const key = `${tier}|${requiresIdentityVerified}|${[...skillIds].sort().join(',')}|${[...credentialTypeIds].sort().join(',')}`

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    // Debounced: the toggles fire fast, and each call scans every worker.
    const timer = setTimeout(() => {
      api
        .qualifyingCount(
          { tier, requiresIdentityVerified, skillIds, credentialTypeIds },
          ctrl.signal,
        )
        .then((r) => {
          setCount(r)
          setError(null)
          seen.current = true
        })
        .catch((e) => {
          if (ctrl.signal.aborted) return
          setError(e instanceof ApiError ? e.message : 'Could not count workers')
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setLoading(false)
        })
    }, 350)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (error) {
    return (
      <div className="reqpanel">
        <span className="rp-err">{error}</span>
      </div>
    )
  }

  const q = count?.qualifying ?? 0
  const pool = count?.inTier ?? 0
  const pct = pool > 0 ? Math.round((q / pool) * 100) : 0
  // Nobody qualifying is not a styling nuance - it is a task that will sit
  // empty, and it should look like a problem before it is published.
  const tone = !count ? 'idle' : q === 0 ? 'bad' : pct < 25 ? 'warn' : 'ok'

  return (
    <div className={`reqpanel ${tone} ${loading && !seen.current ? 'rp-loading' : ''}`}>
      <div className="rp-head">
        <Icon name="users" size={13} />
        <b>Who can take this</b>
      </div>
      {!count ? (
        <span className="rp-sub">Counting…</span>
      ) : (
        <>
          <div className="rp-num">
            <strong>{q}</strong>
            <span>
              of {pool} {TIER_LABELS[tier]} worker{pool === 1 ? '' : 's'}
            </span>
          </div>
          {q === 0 && (
            <p className="rp-warn">
              No one qualifies right now. This task can be published, but nobody will be
              able to apply until a worker meets these requirements.
            </p>
          )}
          {count.blockedBy.length > 0 && (
            <ul className="rp-list">
              {count.blockedBy
                .filter((b) => b.label !== 'Not in this tier')
                .slice(0, 5)
                .map((b) => (
                  <li key={b.label}>
                    <span>{b.label}</span>
                    <em>{b.count} excluded</em>
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

/** Multi-select chips over a catalogue. Same shape for skills and documents. */
function ChipPicker<T extends { id: string; name: string }>({
  items,
  selected,
  onToggle,
  empty,
}: {
  items: T[]
  selected: string[]
  onToggle: (id: string) => void
  empty: string
}) {
  if (items.length === 0) return <p className="req-empty">{empty}</p>
  return (
    <div className="chiprow">
      {items.map((it) => {
        const on = selected.includes(it.id)
        return (
          <button
            key={it.id}
            type="button"
            role="checkbox"
            aria-checked={on}
            className={`chip ${on ? 'on' : ''}`}
            onClick={() => onToggle(it.id)}
          >
            {on && <Icon name="check" size={13} />}
            {it.name}
          </button>
        )
      })}
    </div>
  )
}

interface FormState {
  title: string
  description: string
  category: string
  tier: Tier
  payModel: PayModel
  rate: string
  budget: string
  startDate: string
  endDate: string
  locationType: LocationType
  address: string
  lat: string
  lng: string
  geofenceRadius: string
  slots: string
  /** People, lead included, who may take it as a crew. '' or 0 = solo. */
  crewMax: string
  deadline: string
  requiresIdentityVerified: boolean
  skillIds: string[]
  credentialTypeIds: string[]
  questions: TaskQuestion[]
  /** PER_UNIT: what one unit is, and the most one person may hand in. */
  unitLabel: string
  maxUnits: string
  /** Photos of the finished work required at hand-in. */
  proofPhotos: string
  /** What the reviewer confirms before approving, one per line. */
  acceptanceCriteria: string[]
}

const EMPTY_FORM: FormState = {
  title: '',
  description: '',
  category: '',
  tier: 'DISPATCH',
  payModel: 'HOURLY',
  rate: '',
  budget: '',
  startDate: '',
  endDate: '',
  locationType: 'PHYSICAL',
  address: '',
  lat: '',
  lng: '',
  geofenceRadius: '100',
  slots: '1',
  crewMax: '',
  deadline: '',
  // Defaults ON for a NEW task, while migration 0008 defaults the column false
  // for existing ones. Those are different decisions and both are deliberate:
  // a person is choosing it here, on a task nobody has applied to yet, whereas
  // defaulting the column true would have silently gated every task already
  // live in the pilot with no admin having decided anything.
  requiresIdentityVerified: true,
  skillIds: [],
  credentialTypeIds: [],
  questions: [],
  unitLabel: '',
  maxUnits: '',
  proofPhotos: '0',
  acceptanceCriteria: [],
}

/** The form's reusable part: everything but dates, which are never the same twice. */
function templatePayload(f: FormState): Partial<CreateTaskBody> {
  return {
    title: f.title.trim(),
    description: f.description.trim(),
    category: f.category.trim(),
    tier: f.tier,
    payModel: f.payModel,
    rate: f.rate ? Number(f.rate) : undefined,
    budget: f.budget ? Number(f.budget) : undefined,
    locationType: f.locationType,
    address: f.address.trim() || undefined,
    lat: f.lat ? Number(f.lat) : undefined,
    lng: f.lng ? Number(f.lng) : undefined,
    geofenceRadius: Number(f.geofenceRadius) || 100,
    slots: Number(f.slots) || 1,
    crewMax: Number(f.crewMax) || 0,
    requiresIdentityVerified: f.requiresIdentityVerified,
    skillIds: f.skillIds,
    credentialTypeIds: f.credentialTypeIds,
    questions: f.questions,
    unitLabel: f.unitLabel.trim() || undefined,
    maxUnits: f.maxUnits ? Number(f.maxUnits) : undefined,
    proofPhotos: Number(f.proofPhotos) || 0,
    acceptanceCriteria: f.acceptanceCriteria.map((c) => c.trim()).filter(Boolean),
  }
}

/** A template back into the form. Missing fields keep the blank form's value. */
function formFromTemplate(t: TaskTemplate): FormState {
  const p = t.payload
  const str = (v: unknown) => (v === undefined || v === null ? '' : String(v))
  return {
    ...EMPTY_FORM,
    title: str(p.title),
    description: str(p.description),
    category: str(p.category),
    tier: TIERS.includes(p.tier as Tier) ? (p.tier as Tier) : EMPTY_FORM.tier,
    payModel: p.payModel === 'FIXED' || p.payModel === 'PER_UNIT' ? p.payModel : 'HOURLY',
    rate: str(p.rate),
    budget: str(p.budget),
    locationType: p.locationType === 'REMOTE' ? 'REMOTE' : 'PHYSICAL',
    address: str(p.address),
    lat: str(p.lat),
    lng: str(p.lng),
    geofenceRadius: str(p.geofenceRadius) || '100',
    slots: str(p.slots) || '1',
    crewMax: p.crewMax ? String(p.crewMax) : '',
    requiresIdentityVerified: p.requiresIdentityVerified !== false,
    skillIds: Array.isArray(p.skillIds) ? p.skillIds : [],
    credentialTypeIds: Array.isArray(p.credentialTypeIds) ? p.credentialTypeIds : [],
    questions: Array.isArray(p.questions) ? p.questions : [],
    unitLabel: str(p.unitLabel),
    maxUnits: str(p.maxUnits),
    proofPhotos: str(p.proofPhotos) || '0',
    acceptanceCriteria: Array.isArray(p.acceptanceCriteria) ? p.acceptanceCriteria : [],
  }
}

function NewTaskModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (t: Task) => void
}) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Two steps, not one long form. Requirements decide who can ever see the
  // task, which is a different kind of decision from what it pays - and it is
  // the only one that needs its consequence shown back (see QualifyingPanel).
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [templateId, setTemplateId] = useState('')
  const [saveAsTemplate, setSaveAsTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')

  const skills = useApi((signal) => api.skills(false, signal))
  const credTypes = useApi((signal) => api.credentialTypes(false, signal))
  const categories = useApi((signal) => api.categories(signal))
  const templates = useApi((signal) => api.taskTemplates(signal))

  const activeCategories = useMemo(
    () => (categories.data ?? []).filter((c) => c.active).map((c) => c.name),
    [categories.data]
  )
  const typedCategory = form.category.trim().replace(/\s+/g, ' ')
  // Same rule as the server (services/categories.ts): case and spacing never
  // make a new category.
  const isNewCategory =
    typedCategory !== '' &&
    !(categories.data ?? []).some((c) => c.name.toLowerCase() === typedCategory.toLowerCase())

  function applyTemplate(id: string) {
    setTemplateId(id)
    const t = templates.data?.find((x) => x.id === id)
    if (t) setForm(formFromTemplate(t))
  }

  async function removeTemplate() {
    if (!templateId) return
    try {
      await api.deleteTaskTemplate(templateId)
      setTemplateId('')
      templates.reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove the template')
    }
  }

  const skillGroups = useMemo(() => {
    const map = new Map<string, Skill[]>()
    for (const sk of skills.data ?? []) {
      const arr = map.get(sk.group) ?? []
      arr.push(sk)
      map.set(sk.group, arr)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [skills.data])

  const docs: CredentialType[] = credTypes.data ?? []

  function set<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm((f) => ({ ...f, [key]: val }))
  }

  function toggleId(key: 'skillIds' | 'credentialTypeIds', id: string) {
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id],
    }))
  }

  function close() {
    setForm(EMPTY_FORM)
    setStep(1)
    setError(null)
    setTemplateId('')
    setSaveAsTemplate(false)
    setTemplateName('')
    onClose()
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    // Step 1 submits by advancing, so the browser still runs its own required-
    // field validation on the details before requirements are chosen.
    if (step < 3) {
      setError(null)
      setStep(step === 1 ? 2 : 3)
      return
    }
    setError(null)
    setSubmitting(true)
    const body: CreateTaskBody = {
      title: form.title.trim(),
      description: form.description.trim(),
      category: typedCategory || TIER_LABELS[form.tier],
      tier: form.tier,
      payModel: form.payModel,
      rate: form.payModel !== 'FIXED' ? Number(form.rate) || 0 : undefined,
      unitLabel: form.payModel === 'PER_UNIT' ? form.unitLabel.trim() : undefined,
      maxUnits: form.payModel === 'PER_UNIT' && form.maxUnits ? Number(form.maxUnits) : undefined,
      proofPhotos: Number(form.proofPhotos) || 0,
      acceptanceCriteria: form.acceptanceCriteria.map((c) => c.trim()).filter(Boolean),
      budget: form.payModel === 'FIXED' ? Number(form.budget) || 0 : undefined,
      startDate: form.startDate || new Date().toISOString(),
      endDate: form.endDate || new Date().toISOString(),
      locationType: form.locationType,
      address: form.locationType === 'PHYSICAL' ? form.address.trim() : undefined,
      lat: form.locationType === 'PHYSICAL' && form.lat ? Number(form.lat) : undefined,
      lng: form.locationType === 'PHYSICAL' && form.lng ? Number(form.lng) : undefined,
      geofenceRadius: Number(form.geofenceRadius) || 100,
      slots: Number(form.slots) || 1,
      crewMax: form.payModel === 'FIXED' ? Number(form.crewMax) || 0 : 0,
      deadline: form.deadline || new Date().toISOString(),
      requiresIdentityVerified: form.requiresIdentityVerified,
      skillIds: form.skillIds,
      credentialTypeIds: form.credentialTypeIds,
      questions: form.questions.map((q) => ({
        ...q,
        label: q.label.trim(),
        options: q.type === 'CHOICE' ? q.options?.map((o) => o.trim()).filter(Boolean) : undefined,
      })),
    }
    try {
      const created = await api.createTask(body)
      onCreated(created)
      // The task is out; a template that fails to save must not undo that.
      if (saveAsTemplate && templateName.trim()) {
        await api
          .createTaskTemplate(templateName.trim(), templatePayload(form))
          .then(() => templates.reload())
          .catch(() => {})
      }
      categories.reload()
      close()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create task')
      // Back to the step that can actually be corrected: every field the
      // server rejects on lives in the details.
      setStep(1)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Post a new task"
      subtitle={
        step === 1
          ? 'Step 1 of 3 · The work'
          : step === 2
            ? 'Step 2 of 3 · Who can take it'
            : 'Step 3 of 3 · Questions and proof of work'
      }
      onClose={close}
      size={step === 1 ? 'default' : 'wide'}
    >
      <form onSubmit={submit}>
        {step === 1 && (
        <div className="formgrid">
          {(templates.data?.length ?? 0) > 0 && (
            <div className="field span2">
              <Label htmlFor="t-tpl">Start from a template</Label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <Select
                    id="t-tpl"
                    value={templateId}
                    onChange={applyTemplate}
                    placeholder="Blank task"
                    options={(templates.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
                  />
                </div>
                {templateId && (
                  <Button type="button" variant="glass" size="sm" onClick={removeTemplate} title="Delete this template">
                    Delete template
                  </Button>
                )}
              </div>
            </div>
          )}
          <div className="field span2">
            <Label htmlFor="t-title">Title</Label>
            <Input
              id="t-title"
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="Same-day parcel runs, Yaba"
              required
            />
          </div>
          <div className="field span2">
            <Label htmlFor="t-desc">Description</Label>
            <Textarea
              id="t-desc"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="What the worker will do…"
            />
          </div>
          <div className="field">
            <Label htmlFor="t-cat">Category</Label>
            <Input
              id="t-cat"
              list="t-cat-list"
              maxLength={60}
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
              placeholder="Pick or type a new one"
            />
            <datalist id="t-cat-list">
              {activeCategories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            {isNewCategory && (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                New category: “{typedCategory}” is added to the list when you publish
              </div>
            )}
          </div>
          <div className="field">
            <Label htmlFor="t-tier">Tier</Label>
            <Select
              id="t-tier"
              value={form.tier}
              onChange={(v) => set('tier', v as Tier)}
              options={TIERS.map((t) => ({ value: t, label: TIER_LABELS[t] }))}
            />
          </div>
          <div className="field">
            <Label htmlFor="t-pm">Pay model</Label>
            <Select
              id="t-pm"
              value={form.payModel}
              onChange={(v) => set('payModel', v as PayModel)}
              options={[
                { value: 'HOURLY', label: 'Hourly' },
                { value: 'FIXED', label: 'Fixed' },
                { value: 'PER_UNIT', label: 'Per unit (per photo, per survey…)' },
              ]}
            />
          </div>
          {form.payModel === 'PER_UNIT' ? (
            <>
              <div className="field">
                <Label htmlFor="t-unit">One unit is a…</Label>
                <Input
                  id="t-unit"
                  value={form.unitLabel}
                  maxLength={30}
                  onChange={(e) => set('unitLabel', e.target.value)}
                  placeholder="photo"
                  required
                />
              </div>
              <div className="field">
                <Label htmlFor="t-urate">Pay per {form.unitLabel.trim() || 'unit'} (₦)</Label>
                <Input
                  id="t-urate"
                  className="tnum"
                  type="number"
                  min="1"
                  value={form.rate}
                  onChange={(e) => set('rate', e.target.value)}
                  placeholder="150"
                  required
                />
              </div>
              <div className="field">
                <Label htmlFor="t-umax">Most per person (optional)</Label>
                <Input
                  id="t-umax"
                  className="tnum"
                  type="number"
                  min="1"
                  value={form.maxUnits}
                  onChange={(e) => set('maxUnits', e.target.value)}
                  placeholder="No limit"
                />
              </div>
            </>
          ) : form.payModel === 'HOURLY' ? (
            <div className="field">
              <Label htmlFor="t-rate">Rate (₦/hour)</Label>
              <Input
                id="t-rate"
                className="tnum"
                type="number"
                min="0"
                value={form.rate}
                onChange={(e) => set('rate', e.target.value)}
                placeholder="2500"
                required
              />
            </div>
          ) : (
            <div className="field">
              <Label htmlFor="t-budget">Budget (₦)</Label>
              <Input
                id="t-budget"
                className="tnum"
                type="number"
                min="0"
                value={form.budget}
                onChange={(e) => set('budget', e.target.value)}
                placeholder="18000"
                required
              />
            </div>
          )}
          <div className="field">
            <Label htmlFor="t-slots">Slots</Label>
            <Input
              id="t-slots"
              className="tnum"
              type="number"
              min="1"
              value={form.slots}
              onChange={(e) => set('slots', e.target.value)}
              required
            />
          </div>
          {/* A lead Tasker may bring a crew and split the budget (Blueprint
              §14). Fixed price only: hourly pay is each person's own hours. */}
          {form.payModel === 'FIXED' && (
            <div className="field">
              <Label htmlFor="t-crew">Crew of up to</Label>
              <Input
                id="t-crew"
                className="tnum"
                type="number"
                min="0"
                max="10"
                value={form.crewMax}
                onChange={(e) => set('crewMax', e.target.value)}
                placeholder="Solo"
              />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                {Number(form.crewMax) >= 2
                  ? `A lead can bring up to ${Number(form.crewMax) - 1} others and split the budget`
                  : 'Leave empty for one person per slot'}
              </div>
            </div>
          )}
          <div className="field">
            <Label htmlFor="t-loc">Location type</Label>
            <Select
              id="t-loc"
              value={form.locationType}
              onChange={(v) => set('locationType', v as LocationType)}
              options={[
                { value: 'PHYSICAL', label: 'Physical' },
                { value: 'REMOTE', label: 'Remote' },
              ]}
            />
          </div>
          {form.locationType === 'PHYSICAL' && (
            <>
              <div className="field span2">
                <Label htmlFor="t-addr">Address</Label>
                <Input
                  id="t-addr"
                  value={form.address}
                  onChange={(e) => set('address', e.target.value)}
                  placeholder="Ikeja City Mall"
                />
              </div>
              <div className="field">
                <Label htmlFor="t-lat">Latitude (optional)</Label>
                <Input
                  id="t-lat"
                  className="tnum"
                  type="number"
                  step="any"
                  value={form.lat}
                  onChange={(e) => set('lat', e.target.value)}
                  placeholder="6.6018"
                />
              </div>
              <div className="field">
                <Label htmlFor="t-lng">Longitude (optional)</Label>
                <Input
                  id="t-lng"
                  className="tnum"
                  type="number"
                  step="any"
                  value={form.lng}
                  onChange={(e) => set('lng', e.target.value)}
                  placeholder="3.3515"
                />
              </div>
              <div className="field">
                <Label htmlFor="t-geo">Geofence radius (m)</Label>
                <Input
                  id="t-geo"
                  className="tnum"
                  type="number"
                  min="0"
                  value={form.geofenceRadius}
                  onChange={(e) => set('geofenceRadius', e.target.value)}
                />
              </div>
            </>
          )}
          <div className="field">
            <Label htmlFor="t-start">Start date</Label>
            <Input
              id="t-start"
              type="date"
              value={form.startDate}
              onChange={(e) => set('startDate', e.target.value)}
            />
          </div>
          <div className="field">
            <Label htmlFor="t-end">End date</Label>
            <Input
              id="t-end"
              type="date"
              value={form.endDate}
              onChange={(e) => set('endDate', e.target.value)}
            />
          </div>
          <div className="field span2">
            <Label htmlFor="t-deadline">Application deadline</Label>
            <Input
              id="t-deadline"
              type="date"
              value={form.deadline}
              onChange={(e) => set('deadline', e.target.value)}
            />
          </div>
        </div>
        )}

        {step === 2 && (
          <div className="reqstep">
            <div className="reqcol">
              <div className="reqblock">
                <div className="reqhead">
                  <div>
                    <b>Confirmed ID</b>
                    <span>
                      Only workers whose ID we have checked can apply.
                    </span>
                  </div>
                  <Switch
                    checked={form.requiresIdentityVerified}
                    onChange={(v) => set('requiresIdentityVerified', v)}
                    label="Require confirmed ID"
                  />
                </div>
              </div>

              <div className="reqblock">
                <div className="reqhead">
                  <div>
                    <b>Documents</b>
                    <span>
                      Checked by us before they count. A worker who has uploaded one but
                      is still waiting on our review cannot apply yet.
                    </span>
                  </div>
                </div>
                <ChipPicker
                  items={docs}
                  selected={form.credentialTypeIds}
                  onToggle={(id) => toggleId('credentialTypeIds', id)}
                  empty="No document types set up yet. Add them in Settings."
                />
              </div>

              <div className="reqblock">
                <div className="reqhead">
                  <div>
                    <b>Skills</b>
                    <span>
                      Self-declared. Useful for matching, but a worker only has to say
                      they have these - nobody checks them.
                    </span>
                  </div>
                </div>
                {skillGroups.length === 0 ? (
                  <p className="req-empty">No skills set up yet. Add them in Settings.</p>
                ) : (
                  skillGroups.map(([group, items]) => (
                    <div key={group} className="reqgroup">
                      <span className="reqgroup-t">{group}</span>
                      <ChipPicker
                        items={items}
                        selected={form.skillIds}
                        onToggle={(id) => toggleId('skillIds', id)}
                        empty=""
                      />
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="reqaside">
              <QualifyingPanel
                tier={form.tier}
                requiresIdentityVerified={form.requiresIdentityVerified}
                skillIds={form.skillIds}
                credentialTypeIds={form.credentialTypeIds}
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div style={{ display: 'grid', gap: 18 }}>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
              Anything you need to know before choosing people: their area, their equipment, a
              sample of their work. Applicants answer in the app when they apply, and you see the
              answers beside each application.
            </p>
            <QuestionsEditor value={form.questions} onChange={(q) => set('questions', q)} />
            <div className="reqblock" style={{ display: 'grid', gap: 10 }}>
              <div className="reqhead">
                <div>
                  <b>Proof of work</b>
                  <span>
                    What has to be true before anyone is paid. The reviewer ticks every check
                    before approving, and the worker sees them before they start.
                  </span>
                </div>
              </div>
              {form.acceptanceCriteria.map((c, i) => (
                <div key={i} style={{ display: 'flex', gap: 8 }}>
                  <Input
                    aria-label={`Check ${i + 1}`}
                    value={c}
                    maxLength={200}
                    onChange={(e) =>
                      set('acceptanceCriteria', form.acceptanceCriteria.map((x, j) => (j === i ? e.target.value : x)))
                    }
                    placeholder="e.g. Every shelf photographed, price tags readable"
                  />
                  <Button
                    type="button"
                    variant="glass"
                    size="sm"
                    onClick={() => set('acceptanceCriteria', form.acceptanceCriteria.filter((_, j) => j !== i))}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              {form.acceptanceCriteria.length < 10 && (
                <div>
                  <Button
                    type="button"
                    variant="glass"
                    size="sm"
                    icon="plus"
                    onClick={() => set('acceptanceCriteria', [...form.acceptanceCriteria, ''])}
                  >
                    Add a check
                  </Button>
                </div>
              )}
              <div className="field" style={{ maxWidth: 260 }}>
                <Label htmlFor="t-proof">Photos of the finished work</Label>
                <Input
                  id="t-proof"
                  className="tnum"
                  type="number"
                  min="0"
                  max="10"
                  value={form.proofPhotos}
                  onChange={(e) => set('proofPhotos', e.target.value)}
                />
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  Taken in the app, with time and place, before they can hand in. 0 = none.
                </div>
              </div>
            </div>
            <div className="reqblock">
              <div className="reqhead">
                <div>
                  <b>Save as a template</b>
                  <span>Post this kind of task again in one click. Dates are not saved.</span>
                </div>
                <Switch checked={saveAsTemplate} onChange={setSaveAsTemplate} label="Save as a template" />
              </div>
              {saveAsTemplate && (
                <div style={{ marginTop: 10 }}>
                  <Input
                    aria-label="Template name"
                    value={templateName}
                    maxLength={80}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder={form.title ? `e.g. ${form.title}` : 'Template name'}
                    required
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="login-error" role="alert" style={{ marginTop: 16 }}>
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22 }}>
          <Button
            type="button"
            variant="glass"
            onClick={() => (step > 1 ? setStep(step === 3 ? 2 : 1) : close())}
          >
            {step > 1 ? 'Back' : 'Cancel'}
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon={step < 3 ? undefined : 'check'}
            loading={submitting}
          >
            {step === 1 ? 'Next: requirements' : step === 2 ? 'Next: questions and proof' : 'Publish task'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default function Tasks() {
  const { data, loading, error, reload, setData } = useApi((signal) => api.tasks(signal))
  const [params, setParams] = useSearchParams()
  const [modalOpen, setModalOpen] = useState(false)

  // open modal if topbar linked here with ?new=1
  useEffect(() => {
    if (params.get('new') === '1') {
      setModalOpen(true)
      params.delete('new')
      setParams(params, { replace: true })
    }
  }, [params, setParams])

  const tasks = data ?? []
  const open = tasks.filter((t) => t.status === 'OPEN').length

  return (
    <>
      <PageHeader
        crumb="Operations / Tasks"
        title="Tasks"
        sub={
          loading
            ? 'Loading…'
            : `${tasks.length} total · ${open} open`
        }
        actions={
          <Button variant="primary" size="sm" icon="plus" onClick={() => setModalOpen(true)}>
            New task
          </Button>
        }
      />

      {loading ? (
        <LoadingState label="Loading tasks…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : tasks.length === 0 ? (
        <div className="glass">
          <EmptyState
            icon="tasks"
            title="No tasks yet"
            sub="Post your first task: hourly or fixed, with an optional geofence."
            action={
              <Button variant="primary" size="sm" icon="plus" onClick={() => setModalOpen(true)}>
                New task
              </Button>
            }
          />
        </div>
      ) : (
        <div className="taskgrid">
          {tasks.map((t, i) => (
            <TaskCard key={t.id} task={t} delay={`d${(i % 5) + 1}`} />
          ))}
          <button
            className="glass tcard tcard-add rv in d5"
            onClick={() => setModalOpen(true)}
            aria-label="Post a new task"
          >
            <div className="add-inner">
              <div className="add-ic">
                <Icon name="plus" style={{ color: 'var(--gold)' }} size={22} />
              </div>
              <b>Post a new task</b>
              <span>Hourly or fixed · with geofence</span>
            </div>
          </button>
        </div>
      )}

      <NewTaskModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(t) => setData((prev) => [t, ...(prev ?? [])])}
      />
    </>
  )
}
