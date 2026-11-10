import { useEffect, useMemo, useState, type FormEvent } from 'react'
import TalentProfileModal from '../components/TalentProfileModal'
import { api, ApiError } from '../api/client'
import { useApi } from '../lib/useApi'
import { avatarGradient, formatDate, formatNairaCompact, initials } from '../lib/format'
import type {
  AlertAudience,
  AlertChannel,
  Candidate,
  EmploymentType,
  Job,
  JobAlertInfo,
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
import Input from '../components/ui/Input'
import Textarea from '../components/ui/Textarea'
import Select from '../components/ui/Select'
import { Label } from '@/components/shadcn/label'
import { Checkbox } from '@/components/shadcn/checkbox'
import { Avatar, AvatarFallback } from '@/components/shadcn/avatar'
import { Badge } from '@/components/shadcn/badge'

const STAGES: Stage[] = ['SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED']

/** Stands in for "" in the job filter, which Radix Select will not accept. */
const ALL_ROLES = '__all'

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
  onProfile,
  onShare,
  delay,
}: {
  c: Candidate
  busy: boolean
  onMove: (c: Candidate, stage: Stage) => void
  onProfile: (userId: string) => void
  onShare: (c: Candidate) => void
  delay: string
}) {
  const partner = c.job?.partnerName
  const others = STAGES.filter((s) => s !== c.stage)
  const idx = STAGES.indexOf(c.stage)
  const next = idx >= 0 && idx < 3 ? STAGES[idx + 1] : null // SCREENING→INTERVIEW→OFFER→HIRED

  return (
    <div className={`glass kan-card rv in ${delay}`}>
      <div className="kc-top">
        <Avatar className="wav">
          <AvatarFallback style={{ background: avatarGradient(c.name) }}>
            {initials(c.name)}
          </AvatarFallback>
        </Avatar>
        <div className="kc-id">
          <b>{c.name}</b>
          <span>{c.profile?.headline || c.email}</span>
        </div>
      </div>
      {c.userId && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0' }}>
          <Button variant="glass" size="sm" icon="users" onClick={() => onProfile(c.userId!)}>
            Hiring profile
          </Button>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            {c.profile?.hasCv ? 'CV attached' : 'No CV'} · applied in the app
          </span>
        </div>
      )}
      {c.job?.title && (
        <div className="kc-job">
          <Icon name="briefcase" /> {c.job.title}
        </div>
      )}
      {c.ai && (
        // A suggestion with its reasons, so HR can see why and disagree.
        <div className="kc-ai" style={{ margin: '6px 0', fontSize: 11.5, lineHeight: 1.45 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Badge variant="outline" title="AI suggestion. A person decides.">
              AI fit {c.ai.score}/100
            </Badge>
            <span style={{ color: 'var(--muted)' }}>{c.ai.summary}</span>
          </div>
          {c.ai.strengths.length > 0 && (
            <div style={{ color: 'var(--money)', marginTop: 4 }}>+ {c.ai.strengths.join(' · ')}</div>
          )}
          {c.ai.gaps.length > 0 && <div style={{ color: 'var(--clay)', marginTop: 2 }}>– {c.ai.gaps.join(' · ')}</div>}
        </div>
      )}
      {partner && (
        // Partner jobs: the profile goes to the partner only with the
        // applicant's consent (NDPR), and every share is recorded.
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0', fontSize: 11 }}>
          {c.sharedAt ? (
            <span style={{ color: 'var(--money)' }}>
              <Icon name="check" size={12} /> Shared with {partner} {formatDate(c.sharedAt)}
            </span>
          ) : c.shareConsentAt ? (
            <Button variant="glass" size="sm" icon="send" loading={busy} onClick={() => onShare(c)}>
              Mark shared with {partner}
            </Button>
          ) : (
            <span style={{ color: 'var(--muted)' }}>No consent to share with {partner}</span>
          )}
        </div>
      )}
      {c.coverNote && <p className="kc-note">{c.coverNote}</p>}
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
  partnerName: string
  partnerAbout: string
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
  partnerName: '',
  partnerAbout: '',
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
      partnerName: form.partnerName.trim() || null,
      partnerAbout: form.partnerAbout.trim() || null,
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
            <Label htmlFor="j-title">Title</Label>
            <Input
              id="j-title"
              
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="Operations Associate"
              required
            />
          </div>
          <div className="field">
            <Label htmlFor="j-partner">Hiring for</Label>
            <Input
              id="j-partner"
              value={form.partnerName}
              onChange={(e) => set('partnerName', e.target.value)}
              placeholder="Leave blank for AfriZone"
            />
          </div>
          <div className="field">
            <Label htmlFor="j-partner-about">About the company</Label>
            <Input
              id="j-partner-about"
              value={form.partnerAbout}
              onChange={(e) => set('partnerAbout', e.target.value)}
              placeholder="Shown to applicants (optional)"
              disabled={!form.partnerName.trim()}
            />
          </div>
          {form.partnerName.trim() && (
            <p className="span2" style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
              Applicants must agree to their Hiring profile being shared with {form.partnerName.trim()} before they can
              apply. You then mark each profile as shared when you send it.
            </p>
          )}
          <div className="field">
            <Label htmlFor="j-dept">Department</Label>
            <Input
              id="j-dept"
              
              value={form.department}
              onChange={(e) => set('department', e.target.value)}
              placeholder="Logistics"
              required
            />
          </div>
          <div className="field">
            <Label htmlFor="j-loc">Location</Label>
            <Input
              id="j-loc"
              
              value={form.location}
              onChange={(e) => set('location', e.target.value)}
              placeholder="Lagos"
              required
            />
          </div>
          <div className="field">
            <Label htmlFor="j-emp">Employment type</Label>
            <Select
              id="j-emp"
              value={form.employmentType}
              onChange={(v) => set('employmentType', v as EmploymentType)}
              options={[
                { value: 'FULL_TIME', label: 'Full-time' },
                { value: 'PART_TIME', label: 'Part-time' },
                { value: 'CONTRACT', label: 'Contract' },
              ]}
            />
          </div>
          <div className="field">
            <Label htmlFor="j-close">Closing date</Label>
            <Input
              id="j-close"
              
              type="date"
              value={form.closingDate}
              onChange={(e) => set('closingDate', e.target.value)}
            />
          </div>
          <div className="field">
            <Label htmlFor="j-min">Salary min (₦/mo)</Label>
            <Input
              id="j-min"
              className="tnum"
              type="number"
              min="0"
              value={form.salaryMin}
              onChange={(e) => set('salaryMin', e.target.value)}
              placeholder="250000"
            />
          </div>
          <div className="field">
            <Label htmlFor="j-max">Salary max (₦/mo)</Label>
            <Input
              id="j-max"
              className="tnum"
              type="number"
              min="0"
              value={form.salaryMax}
              onChange={(e) => set('salaryMax', e.target.value)}
              placeholder="400000"
            />
          </div>
          <div className="field span2">
            <Label htmlFor="j-desc">Description</Label>
            <Textarea
              id="j-desc"
              
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="What the role involves…"
            />
          </div>
          <div className="field span2">
            <label>Application requirements</label>
            {/* Explicit id/htmlFor pairs rather than a wrapping <label>: the
                Radix checkbox renders a button, and a label does not forward
                clicks to a button the way it does to a native input. */}
            <div className="checkrow">
              <div className="check">
                <Checkbox
                  id="j-cv"
                  checked={form.needsCv}
                  onCheckedChange={(v) => set('needsCv', v === true)}
                />
                <Label htmlFor="j-cv">CV</Label>
              </div>
              <div className="check">
                <Checkbox
                  id="j-cover"
                  checked={form.needsCover}
                  onCheckedChange={(v) => set('needsCover', v === true)}
                />
                <Label htmlFor="j-cover">Cover letter</Label>
              </div>
              <div className="check">
                <Checkbox
                  id="j-portfolio"
                  checked={form.needsPortfolio}
                  onCheckedChange={(v) => set('needsPortfolio', v === true)}
                />
                <Label htmlFor="j-portfolio">Portfolio</Label>
              </div>
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

const CHANNEL_LABELS: Record<AlertChannel, string> = {
  PUSH: 'App notification',
  EMAIL: 'Email',
  SMS: 'SMS',
  WHATSAPP: 'WhatsApp',
}

/**
 * Send a job out to workers. Shows who it would reach before anything is sent;
 * the server queues it and the per-minute cron sends a batch at a time, so the
 * "sent so far" figures fill in over the next few minutes. Pressing it again
 * only reaches people who haven't had it.
 */
function JobAlertModal({
  job,
  onClose,
  onSent,
}: {
  job: Job
  onClose: () => void
  onSent: (alertedAt: string) => void
}) {
  const [audience, setAudience] = useState<AlertAudience>(job.employmentType === 'FULL_TIME' ? 'EVERYONE' : 'MATCHING')
  const [info, setInfo] = useState<JobAlertInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    const ctl = new AbortController()
    setInfo(null)
    api
      .jobAlerts(job.id, audience, ctl.signal)
      .then(setInfo)
      .catch((e) => {
        if (!ctl.signal.aborted) setError(e instanceof ApiError ? e.message : 'Could not load')
      })
    return () => ctl.abort()
  }, [job.id, audience, result])

  async function send() {
    setSending(true)
    setError(null)
    try {
      const r = await api.sendJobAlerts(job.id, audience)
      setResult(
        r.queued === 0
          ? 'Everyone in this group has already had this alert.'
          : `Queued ${r.queued} message${r.queued === 1 ? '' : 's'} to ${r.people} people. They go out over the next few minutes.`,
      )
      onSent(new Date().toISOString())
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send')
    } finally {
      setSending(false)
    }
  }

  const channels = Object.keys(CHANNEL_LABELS) as AlertChannel[]
  return (
    <Modal open title="Send job alert" subtitle={job.title} onClose={onClose}>
      <div className="field">
        <Label htmlFor="alert-aud">Who hears about it</Label>
        <Select
          id="alert-aud"
          value={audience}
          onChange={(v) => setAudience(v as AlertAudience)}
          options={[
            { value: 'MATCHING', label: "Workers open to this kind of work (and those who haven't said)" },
            { value: 'EVERYONE', label: 'Every worker' },
          ]}
        />
      </div>
      {!info ? (
        <LoadingState label="Counting…" />
      ) : (
        <div style={{ margin: '16px 0', fontSize: 13 }}>
          <p style={{ margin: '0 0 8px' }}>
            <b className="tnum">{info.preview.people}</b> people who haven't applied yet. Each gets it on the channels
            they turned on:
          </p>
          <table style={{ width: '100%', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                <th>Channel</th>
                <th>This send</th>
                <th>Sent so far</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((ch) => {
                const s = info.sent[ch] ?? {}
                const parts = Object.entries(s).map(([k, v]) => `${v} ${k.toLowerCase()}`)
                return (
                  <tr key={ch}>
                    <td>{CHANNEL_LABELS[ch]}</td>
                    <td className="tnum">{info.preview.channels[ch]}</td>
                    <td>{parts.length ? parts.join(', ') : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
            "Skipped" means that channel isn't set up yet (email needs RESEND_API_KEY; WhatsApp needs an approved
            Termii WhatsApp sender).
          </p>
        </div>
      )}
      {result && <p style={{ color: 'var(--money)', fontSize: 13 }}>{result}</p>}
      {error && (
        <div className="login-error" role="alert">
          <Icon name="alert" size={15} />
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
        <Button variant="glass" onClick={onClose}>
          Close
        </Button>
        <Button variant="primary" icon="send" loading={sending} disabled={!info || info.preview.people === 0} onClick={send}>
          Send to {info?.preview.people ?? '…'} people
        </Button>
      </div>
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
  const [profileId, setProfileId] = useState<string | null>(null)
  const [alertJob, setAlertJob] = useState<Job | null>(null)
  const [ranking, setRanking] = useState(false)
  const [rankNote, setRankNote] = useState<string | null>(null)

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
    // Highest suggested fit first; unscored after, newest first as before.
    for (const s of STAGES) map[s].sort((a, b) => (b.ai?.score ?? -1) - (a.ai?.score ?? -1))
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

  async function rank(rescore: boolean) {
    if (!selectedJob) return
    setRanking(true)
    setRankNote(null)
    setActionError(null)
    try {
      const r = await api.shortlistJob(selectedJob.id, rescore)
      setRankNote(
        `${r.scored} applicant${r.scored === 1 ? '' : 's'} scored` +
          (r.remaining ? `, ${r.remaining} still to do: press again.` : '.') +
          (r.error ? ` ${r.error}` : ''),
      )
      candApi.reload()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not rank applicants')
    } finally {
      setRanking(false)
    }
  }

  async function share(c: Candidate) {
    setBusy(c.id)
    setActionError(null)
    try {
      const updated = await api.shareCandidate(c.id)
      candApi.setData((prev) =>
        (prev ?? []).map((x) => (x.id === c.id ? { ...x, sharedAt: updated.sharedAt } : x)),
      )
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not record the share')
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
            {/* Radix rejects an empty-string item value, which is what this
                filter used for "all". ALL_ROLES is the sentinel it maps to. */}
            <Select
              value={jobFilter || ALL_ROLES}
              onChange={(v) => setJobFilter(v === ALL_ROLES ? '' : v)}
              options={[
                { value: ALL_ROLES, label: 'All roles' },
                ...jobs.map((j) => ({ value: j.id, label: j.title })),
              ]}
              ariaLabel="Filter by job"
              className="h-[38px] w-auto"
            />
            <Button variant="primary" size="sm" icon="plus" onClick={() => setModalOpen(true)}>
              Post a job
            </Button>
          </div>
        }
      />

      {selectedJob && (
        <div className="job-meta glass rv in" >
          <Badge variant="outline" className="tier">
            <Icon name="briefcase" /> {EMPLOYMENT_LABELS[selectedJob.employmentType]}
          </Badge>
          <span>
            <Icon name="users" /> Hiring for {selectedJob.partnerName || 'AfriZone'}
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
          <Button variant="glass" size="sm" icon="star" loading={ranking} onClick={() => rank(false)}>
            Rank with AI
          </Button>
          {candidates.some((c) => c.ai) && (
            <Button variant="glass" size="sm" disabled={ranking} onClick={() => rank(true)}>
              Re-rank all
            </Button>
          )}
          {selectedJob.status === 'OPEN' && (
            <Button variant="glass" size="sm" icon="send" onClick={() => setAlertJob(selectedJob)}>
              {selectedJob.alertedAt ? 'Job alert sent · send more' : 'Send job alert'}
            </Button>
          )}
        </div>
      )}

      {rankNote && (
        <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 12px' }}>
          {rankNote} AI scores suggest an order from each applicant's Hiring profile and cover letter, without their name
          or contact details. They don't move anyone: you do.
        </p>
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
                      onProfile={setProfileId}
                      onShare={share}
                      delay={`d${(ci % 5) + 1}`}
                    />
                  ))
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      {profileId && <TalentProfileModal workerId={profileId} onClose={() => setProfileId(null)} />}

      {alertJob && (
        <JobAlertModal
          job={alertJob}
          onClose={() => setAlertJob(null)}
          onSent={(alertedAt) =>
            jobsApi.setData((prev) => (prev ?? []).map((j) => (j.id === alertJob.id ? { ...j, alertedAt } : j)))
          }
        />
      )}

      <NewJobModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(j) => jobsApi.setData((prev) => [j, ...(prev ?? [])])}
      />
    </>
  )
}
