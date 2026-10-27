import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import AuthedImage from '../components/ui/AuthedImage'
import { useApi } from '../lib/useApi'
import type { KycDocument, Worker, WorkerDetail } from '../api/types'
import {
  TIER_COLORS,
  TIER_LABELS,
  avatarGradient,
  initials,
  kycPill,
} from '../lib/format'
import PageHeader from '../components/PageHeader'
import StandingBadge from '../components/StandingBadge'
import Glass from '../components/ui/Glass'
import Button from '../components/ui/Button'
import StatusPill from '../components/ui/StatusPill'
import Modal from '../components/ui/Modal'
import Icon from '../components/Icon'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateView'
import Select from '../components/ui/Select'
import Textarea from '../components/ui/Textarea'
import { Label } from '@/components/shadcn/label'
import { Avatar, AvatarFallback } from '@/components/shadcn/avatar'
import { Badge } from '@/components/shadcn/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/shadcn/table'

const DOC_TYPE_LABEL: Record<string, string> = {
  ID: 'Government ID',
  SELFIE: 'Selfie / Liveness',
  DOCS: 'Supporting Documents',
}

// doc.url points at an authenticated file route (see storage.ts's resolveUrl),
// not a public path - a plain <img src> can't send the Authorization header
// it requires, so this fetches the bytes with the header and hands back an
// object URL instead. Shows a placeholder while loading and on failure
// (expired/invalid token, deleted object, etc.) rather than a broken image.
// ─── KYC document viewer + decision modal ─────────────────────────────────────
function KycDocsModal({
  worker,
  onClose,
  onDecide,
  busyId,
}: {
  worker: Worker
  onClose: () => void
  onDecide: (id: string, decision: 'TIER_APPROVED' | 'REJECTED') => void
  busyId: string | null
}) {
  const [docs, setDocs] = useState<KycDocument[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<KycDocument | null>(null)

  useEffect(() => {
    let cancelled = false
    api.workerKycDocuments(worker.id).then((d) => {
      if (!cancelled) setDocs(d)
    }).catch((e) => {
      if (!cancelled) setLoadErr(e instanceof ApiError ? e.message : 'Could not load documents')
    })
    return () => { cancelled = true }
  }, [worker.id])

  const isPending = worker.kycStatus === 'PENDING'

  return (
    <>
      <Modal
        open
        title={`KYC documents · ${worker.name}`}
        subtitle={`${docs?.length ?? '…'} document${docs?.length !== 1 ? 's' : ''} uploaded · ${worker.kycStatus}`}
        onClose={onClose}
      >
        <div style={{ marginTop: 12 }}>
          {loadErr ? (
            <p style={{ color: 'var(--danger)', fontSize: 13 }}>{loadErr}</p>
          ) : !docs ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
              <span className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
            </div>
          ) : docs.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
              No documents uploaded yet.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {(['ID', 'SELFIE', 'DOCS'] as const).map((type) => {
                const group = docs.filter((d) => d.docType === type)
                if (group.length === 0) return null
                return (
                  <div key={type}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                      {DOC_TYPE_LABEL[type]}
                    </div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {group.map((doc) => (
                        <button
                          key={doc.id}
                          onClick={() => setLightbox(doc)}
                          style={{
                            border: '2px solid var(--line-2)',
                            borderRadius: 10,
                            overflow: 'hidden',
                            cursor: 'pointer',
                            padding: 0,
                            background: 'var(--bg2)',
                            transition: 'border-color .15s',
                            width: 110,
                            height: 110,
                            flexShrink: 0,
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--clay-deep)')}
                          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--line-2)')}
                          title={doc.originalName}
                        >
                          <AuthedImage
                            url={doc.url}
                            alt={doc.originalName}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {isPending && (
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
              <Button
                variant="danger"
                size="sm"
                loading={busyId === worker.id + 'REJECTED'}
                onClick={() => { onDecide(worker.id, 'REJECTED'); onClose() }}
              >
                Reject KYC
              </Button>
              <Button
                variant="money"
                size="sm"
                icon="check"
                loading={busyId === worker.id + 'TIER_APPROVED'}
                onClick={() => { onDecide(worker.id, 'TIER_APPROVED'); onClose() }}
              >
                Approve KYC
              </Button>
            </div>
          )}
        </div>
      </Modal>

      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1100,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <button
            onClick={() => setLightbox(null)}
            style={{
              position: 'absolute', top: 20, right: 20,
              background: 'rgba(255,255,255,.1)', border: 'none', borderRadius: 8,
              color: '#fff', width: 38, height: 38, cursor: 'pointer', fontSize: 20,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-label="Close"
          >
            <Icon name="x" />
          </button>
          <AuthedImage
            url={lightbox.url}
            alt={lightbox.originalName}
            variant="full"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '90vw', maxHeight: '88vh', borderRadius: 12, boxShadow: '0 8px 60px rgba(0,0,0,.5)' }}
          />
          <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', color: 'rgba(255,255,255,.7)', fontSize: 12 }}>
            {DOC_TYPE_LABEL[lightbox.docType]} · {lightbox.originalName}
          </div>
        </div>
      )}
    </>
  )
}

// ─── Star rating picker ───────────────────────────────────────────────────────
const STAR_PATH = 'M12 2l2.9 6.3 6.8.6-5 4.7 1.5 6.8L12 17l-6.2 3.4 1.5-6.8-5-4.7 6.8-.6Z'

function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [hover, setHover] = useState(0)
  const active = hover || value
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(i)}
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(0)}
          style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer' }}
          aria-label={`${i} star${i !== 1 ? 's' : ''}`}
        >
          <svg viewBox="0 0 24 24" width={24} height={24}>
            <path
              d={STAR_PATH}
              fill={i <= active ? 'var(--gold)' : 'none'}
              stroke={i <= active ? 'var(--gold)' : 'var(--muted)'}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ))}
    </div>
  )
}

// ─── Rate worker modal ────────────────────────────────────────────────────────
function RateModal({
  worker,
  onClose,
  onRated,
}: {
  worker: Worker
  onClose: () => void
  onRated: (updated: Pick<Worker, 'id' | 'rating' | 'completedCount'>) => void
}) {
  const [detail, setDetail] = useState<WorkerDetail | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [taskId, setTaskId] = useState('')
  const [score, setScore] = useState(0)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [submitErr, setSubmitErr] = useState<string | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    api.workerDetail(worker.id).then((d) => {
      if (!cancelled) setDetail(d)
    }).catch((e) => {
      if (!cancelled) setLoadErr(e instanceof ApiError ? e.message : 'Could not load worker tasks')
    })
    return () => { cancelled = true }
  }, [worker.id])

  const approvedTasks = (detail?.applications ?? []).filter((a) => a.status === 'APPROVED' && a.task)

  async function submit() {
    if (!taskId || score < 1) return
    setBusy(true)
    setSubmitErr(null)
    try {
      const updated = await api.rateWorker(worker.id, { taskId, score, note: note.trim() || undefined })
      onRated({ id: worker.id, rating: updated.rating, completedCount: updated.completedCount })
      onClose()
    } catch (e) {
      setSubmitErr(e instanceof ApiError ? e.message : 'Rating failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
    >
      <div style={{
        background: 'var(--surface)', borderRadius: 16, padding: 28,
        width: 440, maxWidth: '92vw', boxShadow: '0 8px 40px rgba(0,0,0,0.22)',
      }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 800 }}>Rate {worker.name}</h3>
        <p style={{ margin: '0 0 20px', color: 'var(--muted)', fontSize: 13 }}>
          Rate performance for a completed task. One rating per task is stored.
        </p>

        {loadErr ? (
          <p style={{ color: 'var(--danger)', fontSize: 13 }}>{loadErr}</p>
        ) : !detail ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading tasks…</p>
        ) : approvedTasks.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>
            This worker has no approved tasks to rate yet.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="field">
              <Label htmlFor="rate-task">Task</Label>
              <Select
                id="rate-task"
                value={taskId}
                onChange={setTaskId}
                placeholder="Select a task…"
                options={approvedTasks.map((a) => ({ value: a.taskId, label: a.task!.title }))}
              />
            </div>

            <label style={{ fontSize: 13, fontWeight: 600 }}>
              Score
              <div style={{ marginTop: 8 }}>
                <StarPicker value={score} onChange={setScore} />
                {score > 0 && (
                  <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 4 }}>
                    {score}/5 selected
                  </span>
                )}
              </div>
            </label>

            <div className="field">
              <Label htmlFor="rate-note">
                Note <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional)</span>
              </Label>
              <Textarea
                id="rate-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="Any feedback for the worker…"
              />
            </div>

            {submitErr && (
              <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{submitErr}</p>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="glass" size="sm" onClick={onClose}>Cancel</Button>
              <Button
                variant="money"
                size="sm"
                loading={busy}
                disabled={!taskId || score < 1 || busy}
                onClick={submit}
              >
                Submit rating
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Workers() {
  const { data, loading, error, reload, setData } = useApi((signal) => api.workers(signal))
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [ratingWorker, setRatingWorker] = useState<Worker | null>(null)
  const [kycWorker, setKycWorker] = useState<Worker | null>(null)

  const workers = data ?? []
  const pendingKyc = workers.filter((w) => w.kycStatus === 'PENDING').length

  async function decide(id: string, decision: 'TIER_APPROVED' | 'REJECTED') {
    setBusy(id + decision)
    setActionError(null)
    try {
      const updated = await api.reviewKyc(id, decision)
      setData((prev) => (prev ?? []).map((w) => (w.id === id ? { ...w, ...updated } : w)))
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'KYC review failed')
    } finally {
      setBusy(null)
    }
  }

  function handleRated(updated: Pick<Worker, 'id' | 'rating' | 'completedCount'>) {
    setData((prev) =>
      (prev ?? []).map((w) =>
        w.id === updated.id ? { ...w, rating: updated.rating, completedCount: updated.completedCount } : w
      )
    )
  }

  return (
    <>
      <PageHeader
        crumb="People / Workers"
        title="Worker directory & KYC"
        sub={loading ? 'Loading…' : `${workers.length} workers · ${pendingKyc} KYC reviews pending`}
        actions={
          <Button variant="glass" size="sm" icon="arrow-up">
            Export CSV
          </Button>
        }
      />

      {actionError && (
        <div className="login-error" role="alert" style={{ marginBottom: 16 }}>
          <Icon name="alert" size={15} />
          {actionError}
        </div>
      )}

      {loading ? (
        <LoadingState label="Loading workers…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : workers.length === 0 ? (
        <Glass>
          <EmptyState icon="users" title="No workers yet" sub="Verified workers will appear here for KYC review." />
        </Glass>
      ) : (
        <Glass reveal delay="d1" className="tablewrap">
          <Table className="dt">
            <TableHeader>
              <TableRow>
                <TableHead>Worker</TableHead>
                <TableHead>Tiers</TableHead>
                <TableHead>Standing</TableHead>
                <TableHead>KYC</TableHead>
                <TableHead>Completed</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {workers.map((w) => {
                const pill = kycPill(w.kycStatus)
                return (
                  <TableRow key={w.id}>
                    <TableCell>
                      <div className="wname">
                        <Avatar className="wav">
                          <AvatarFallback style={{ background: avatarGradient(w.name) }}>
                            {initials(w.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          {w.name}
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{w.email}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {(w.tiers ?? []).map((t) => (
                          <Badge variant="outline" className="tier" key={t}>
                            <span className="d" style={{ background: TIER_COLORS[t] }} />
                            {TIER_LABELS[t]}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StandingBadge standing={w.standing} />
                    </TableCell>
                    <TableCell>
                      <StatusPill variant={pill.variant} label={pill.label} />
                    </TableCell>
                    <TableCell className="tnum">{w.completedCount}</TableCell>
                    <TableCell className="tnum">
                      {w.rating != null ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {w.rating.toFixed(1)}
                          <svg viewBox="0 0 24 24" width={13} height={13} fill="var(--gold)" aria-hidden="true">
                            <path d="M12 2l3 7h7l-5.5 4 2 7-6.5-4.5L5.5 22l2-7L2 9h7z" />
                          </svg>
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {w.kycStatus === 'PENDING' && (
                          <Button
                            variant="primary"
                            size="sm"
                            icon="eye"
                            onClick={() => setKycWorker(w)}
                          >
                            Review KYC
                          </Button>
                        )}
                        <Button
                          variant="glass"
                          size="sm"
                          icon="file"
                          onClick={() => setKycWorker(w)}
                          title="View KYC documents"
                        >
                          Docs
                        </Button>
                        {w.kycStatus !== 'PENDING' && (
                          <Button variant="glass" size="sm" onClick={() => setRatingWorker(w)}>
                            Rate
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Glass>
      )}

      {kycWorker && (
        <KycDocsModal
          worker={kycWorker}
          onClose={() => setKycWorker(null)}
          onDecide={decide}
          busyId={busy}
        />
      )}

      {ratingWorker && (
        <RateModal
          worker={ratingWorker}
          onClose={() => setRatingWorker(null)}
          onRated={handleRated}
        />
      )}
    </>
  )
}
