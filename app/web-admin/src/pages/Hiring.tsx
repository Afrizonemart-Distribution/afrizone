import { useMemo, useState, type FormEvent } from 'react'
import { api, ApiError } from '../api/client'
import { useApi } from '../lib/useApi'
import { avatarGradient, formatDate, formatNairaCompact, initials } from '../lib/format'
import type {
  Candidate,
  EmploymentType,
  Job,
  Stage,
} from '../api/types'
import PageHeader from '../components/PageHeader'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Icon from '../components/Icon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/shadcn/dropdown-menu'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateView'
import './Hiring.css'

const STAGES: Stage[] = ['SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED']

const STAGE_LABELS: Record<Stage, string> = {
  SCREENING: 'Screening',
  INTERVIEW: 'Interview',
  OFFER: 'Offer',
  HIRED: 'Hired',
  REJECTED: 'Rejected',
}

const STAGE_COLOR: Record<Stage, string> = {
  SCREENING: 'var(--indigo)',
  INTERVIEW: 'var(--gold)',
  OFFER: 'var(--clay)',
  HIRED: 'var(--money)',
  REJECTED: 'var(--danger)',
}

const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACT: 'Contract',
}

function salaryRange(job?: Job): string {
  if (!job) return ''
  if (job.salaryMin != null && job.salaryMax != null)
    return `${formatNairaCompact(job.salaryMin)}–${formatNairaCompact(job.salaryMax)}`
  if (job.salaryMin != null) return `from ${formatNairaCompact(job.salaryMin)}`
  if (job.salaryMax != null) return `up to ${formatNairaCompact(job.salaryMax)}`
  return ''
}

function CandidateCard({
  c,
  busy,
  onMove,
  delay,
}: {
  c: Candidate
  busy: boolean
  onMove: (c: Candidate, stage: Stage) => void
  delay: string
}) {
  const others = STAGES.filter((s) => s !== c.stage)
  const idx = STAGES.indexOf(c.stage)
  const next = idx >= 0 && idx < 3 ? STAGES[idx + 1] : null // SCREENING→INTERVIEW→OFFER→HIRED

  return (
    <div className={`glass kan-card rv in ${delay}`}>
      <div className="kc-top">
        <span className="wav" style={{ background: avatarGradient(c.name) }}>
          {initials(c.name)}
        </span>
        <div className="kc-id">
          <b>{c.name}</b>
          <span>{c.email}</span>
        </div>
      </div>
      {c.job?.title && (
        <div className="kc-job">
          <Icon name="briefcase" /> {c.job.title}
        </div>
      )}
      {c.cvNote && <p className="kc-note">{c.cvNote}</p>}
      <div className="kc-foot">
        {next ? (
          <Button
            variant="money"
            size="sm"
            icon="arrow-right"
            loading={busy}
            onClick={() => onMove(c, next)}
          >
            Move to {STAGE_LABELS[next]}
          </Button>
        ) : (
          <span className="kc-tag" style={{ color: STAGE_COLOR[c.stage] }}>
            {STAGE_LABELS[c.stage]}
          </span>
        )}
        {/* Radix supplies what the hand-rolled version was missing: arrow-key
            navigation, typeahead, Escape and outside-click to dismiss, and
            focus returned to the trigger on close. It also owns the open state
            and the aria-haspopup/aria-expanded wiring, so both are gone from
            here. Positioning moves from .kc-menu's absolute offsets to Radix's
            collision-aware popper via side/align. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="glass"
              size="sm"
              aria-label="Move candidate to another stage"
              disabled={busy}
            >
              <Icon name="arrow-up" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="kc-menu">
            {others.map((s) => (
              <DropdownMenuItem key={s} className="kc-mi" onSelect={() => onMove(c, s)}>
                <span className="d" style={{ background: STAGE_COLOR[s] }} />
                {STAGE_LABELS[s]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

interface JobFormState {
  title: string
  department: string
  location: string
  employmentType: EmploymentType
  salaryMin: string
  salaryMax: string
  description: string
  needsCv: boolean
  needsCover: boolean
  needsPortfolio: boolean
  closingDate: string
}

const EMPTY_JOB: JobFormState = {
  title: '',
  department: '',
  location: '',
  employmentType: 'FULL_TIME',
  salaryMin: '',
  salaryMax: '',
  description: '',
  needsCv: true,
  needsCover: false,
  needsPortfolio: false,
  closingDate: '',
}

function NewJobModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (j: Job) => void
}) {
  const [form, setForm] = useState<JobFormState>(EMPTY_JOB)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function set<K extends keyof JobFormState>(key: K, val: JobFormState[K]) {
    setForm((f) => ({ ...f, [key]: val }))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const body: Partial<Job> = {
      title: form.title.trim(),
      department: form.department.trim(),
      location: form.location.trim(),
      employmentType: form.employmentType,
      salaryMin: form.salaryMin ? Number(form.salaryMin) : undefined,
      salaryMax: form.salaryMax ? Number(form.salaryMax) : undefined,
      description: form.description.trim(),
      needsCv: form.needsCv,
      needsCover: form.needsCover,
      needsPortfolio: form.needsPortfolio,
      closingDate: form.closingDate || new Date().toISOString(),
    }
    try {
      const created = await api.createJob(body)
      onCreated(created)
      setForm(EMPTY_JOB)
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to post job')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} title="Post a job" subtitle="Roles for the hiring pipeline" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="formgrid">
          <div className="field span2">
            <label htmlFor="j-title">Title</label>
            <input
              id="j-title"
              className="input"
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="Operations Associate"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="j-dept">Department</label>
            <input
              id="j-dept"
              className="input"
              value={form.department}
              onChange={(e) => set('department', e.target.value)}
              placeholder="Logistics"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="j-loc">Location</label>
            <input
              id="j-loc"
              className="input"
              value={form.location}
              onChange={(e) => set('location', e.target.value)}
              placeholder="Lagos"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="j-emp">Employment type</label>
            <select
              id="j-emp"
              className="select"
              value={form.employmentType}
              onChange={(e) => set('employmentType', e.target.value as EmploymentType)}
            >
              <option value="FULL_TIME">Full-time</option>
              <option value="PART_TIME">Part-time</option>
              <option value="CONTRACT">Contract</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="j-close">Closing date</label>
            <input
              id="j-close"
              className="input"
              type="date"
              value={form.closingDate}
              onChange={(e) => set('closingDate', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="j-min">Salary min (₦/mo)</label>
            <input
              id="j-min"
              className="input tnum"
              type="number"
              min="0"
              value={form.salaryMin}
              onChange={(e) => set('salaryMin', e.target.value)}
              placeholder="250000"
            />
          </div>
          <div className="field">
            <label htmlFor="j-max">Salary max (₦/mo)</label>
            <input
              id="j-max"
              className="input tnum"
              type="number"
              min="0"
              value={form.salaryMax}
              onChange={(e) => set('salaryMax', e.target.value)}
              placeholder="400000"
            />
          </div>
          <div className="field span2">
            <label htmlFor="j-desc">Description</label>
            <textarea
              id="j-desc"
              className="textarea"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="What the role involves…"
            />
          </div>
          <div className="field span2">
            <label>Application requirements</label>
            <div className="checkrow">
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.needsCv}
                  onChange={(e) => set('needsCv', e.target.checked)}
                />
                CV
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.needsCover}
                  onChange={(e) => set('needsCover', e.target.checked)}
                />
                Cover letter
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.needsPortfolio}
                  onChange={(e) => set('needsPortfolio', e.target.checked)}
                />
                Portfolio
              </label>
            </div>
          </div>
        </div>

        {error && (
          <div className="login-error" role="alert" style={{ marginTop: 16 }}>
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22 }}>
          <Button type="button" variant="glass" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon="check" loading={submitting}>
            Post job
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default function Hiring() {
  const jobsApi = useApi((signal) => api.jobs(signal))
  const [jobFilter, setJobFilter] = useState<string>('')
  const candApi = useApi(
    (signal) => api.candidates(jobFilter || undefined, signal),
    [jobFilter],
  )

  const [modalOpen, setModalOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const jobs = useMemo(() => jobsApi.data ?? [], [jobsApi.data])
  const candidates = useMemo(() => candApi.data ?? [], [candApi.data])

  const byStage = useMemo(() => {
    const map: Record<Stage, Candidate[]> = {
      SCREENING: [],
      INTERVIEW: [],
      OFFER: [],
      HIRED: [],
      REJECTED: [],
    }
    for (const c of candidates) map[c.stage]?.push(c)
    return map
  }, [candidates])

  const selectedJob = jobs.find((j) => j.id === jobFilter)

  async function move(c: Candidate, stage: Stage) {
    setBusy(c.id)
    setActionError(null)
    try {
      const updated = await api.moveCandidate(c.id, stage)
      candApi.setData((prev) =>
        (prev ?? []).map((x) => (x.id === c.id ? { ...x, ...updated } : x)),
      )
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not move candidate')
    } finally {
      setBusy(null)
    }
  }

  const loading = jobsApi.loading || candApi.loading
  const error = candApi.error ?? jobsApi.error

  return (
    <>
      <PageHeader
        crumb="People / Hiring"
        title="Hiring pipeline"
        sub={
          loading
            ? 'Loading…'
            : `${candidates.length} candidate${candidates.length === 1 ? '' : 's'}${
                selectedJob ? ` · ${selectedJob.title}` : ' across all roles'
              }`
        }
        actions={
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              className="select"
              style={{ minHeight: 38, width: 'auto' }}
              value={jobFilter}
              onChange={(e) => setJobFilter(e.target.value)}
              aria-label="Filter by job"
            >
              <option value="">All roles</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                </option>
              ))}
            </select>
            <Button variant="primary" size="sm" icon="plus" onClick={() => setModalOpen(true)}>
              Post a job
            </Button>
          </div>
        }
      />

      {selectedJob && (
        <div className="job-meta glass rv in" >
          <span className="tier">
            <Icon name="briefcase" /> {EMPLOYMENT_LABELS[selectedJob.employmentType]}
          </span>
          <span>
            <Icon name="pin" /> {selectedJob.location || 'Remote'}
          </span>
          {salaryRange(selectedJob) && (
            <span>
              <Icon name="naira" /> {salaryRange(selectedJob)}/mo
            </span>
          )}
          <span>
            <Icon name="calendar" /> Closes {formatDate(selectedJob.closingDate)}
          </span>
        </div>
      )}

      {actionError && (
        <div className="login-error" role="alert" style={{ marginBottom: 16 }}>
          <Icon name="alert" size={15} />
          {actionError}
        </div>
      )}

      {loading ? (
        <LoadingState label="Loading pipeline…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => { jobsApi.reload(); candApi.reload() }} />
      ) : candidates.length === 0 ? (
        <div className="glass">
          <EmptyState
            icon="briefcase"
            title="No candidates yet"
            sub="Post a role and applicants will appear on the board, grouped by stage."
            action={
              <Button variant="primary" size="sm" icon="plus" onClick={() => setModalOpen(true)}>
                Post a job
              </Button>
            }
          />
        </div>
      ) : (
        <div className="kanban">
          {STAGES.map((s, si) => (
            <section key={s} className={`glass kan-col rv in d${(si % 5) + 1}`}>
              <header className="kan-h">
                <span className="kan-dot" style={{ background: STAGE_COLOR[s] }} />
                <h3>{STAGE_LABELS[s]}</h3>
                <span className="kan-count tnum">{byStage[s].length}</span>
              </header>
              <div className="kan-body">
                {byStage[s].length === 0 ? (
                  <div className="kan-empty">No candidates</div>
                ) : (
                  byStage[s].map((c, ci) => (
                    <CandidateCard
                      key={c.id}
                      c={c}
                      busy={busy === c.id}
                      onMove={move}
                      delay={`d${(ci % 5) + 1}`}
                    />
                  ))
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      <NewJobModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(j) => jobsApi.setData((prev) => [j, ...(prev ?? [])])}
      />
    </>
  )
}
