/**
 * HR's view of a worker's Talent Profile (server: services/talentProfile.ts,
 * the "staff" cut: everything, including contact details and private files).
 *
 * Kept visually in three bands, because the difference is the point:
 *   Verified by AfriZone (computed, nobody typed it) > checked certificates >
 *   the worker's own claims.
 */
import { useEffect, useState } from 'react'
import { api, ApiError, fetchAuthedObjectUrl } from '../api/client'
import Modal from './ui/Modal'
import Button from './ui/Button'
import StatusPill from './ui/StatusPill'

interface ProfileFile {
  id: string
  name: string
  url: string
}

interface Talent {
  name: string
  headline: string | null
  bio: string | null
  location: string | null
  openTo: string[]
  memberSince: string
  identityVerified: boolean
  email?: string
  phone?: string | null
  visibility?: 'PRIVATE' | 'LINK'
  slug?: string | null
  cv?: ProfileFile | null
  workRecord: {
    paidTasks: number
    byCategory: { category: string; count: number }[]
    rating: number | null
    ratingsCount: number
  }
  experience: {
    id: string
    title: string
    company: string
    location: string | null
    startDate: string
    endDate: string | null
    description: string | null
  }[]
  education: {
    id: string
    institution: string
    qualification: string
    field: string | null
    endYear: number | null
  }[]
  portfolio: { id: string; title: string; description: string | null; url: string | null; file: ProfileFile | null }[]
  skills: { name: string; years: number | null }[]
  credentials: { id: string; title: string; type: string; issuer: string | null; verified: boolean; status?: string }[]
}

const OPEN_TO_LABEL: Record<string, string> = {
  TASKS: 'One-off tasks',
  HOURLY: 'Hourly',
  CONTRACT: 'Contract',
  FULL_TIME: 'Full-time',
}

const monthYear = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'Present'

/**
 * Files sit behind the authenticated route, so a plain link can't open them.
 * The tab opens synchronously (in the click) so it isn't popup-blocked, then
 * receives the object URL once the bytes arrive.
 */
function openFile(file: ProfileFile) {
  const tab = window.open('', '_blank')
  fetchAuthedObjectUrl(file.url)
    .then(({ url }) => {
      if (tab) tab.location.href = url
      else window.location.href = url
    })
    .catch(() => tab?.close())
}

export default function TalentProfileModal({ workerId, onClose }: { workerId: string; onClose: () => void }) {
  const [t, setT] = useState<Talent | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    api
      .workerProfile(workerId, ctrl.signal)
      .then((d) => setT((d?.talent ?? null) as Talent | null))
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e instanceof ApiError ? e.message : 'Could not load the profile')
      })
    return () => ctrl.abort()
  }, [workerId])

  const head = (s: string) => (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: 'var(--muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        margin: '18px 0 8px',
      }}
    >
      {s}
    </div>
  )
  const line = { fontSize: 13, color: 'var(--muted)' } as const

  return (
    <Modal
      open
      title={t ? `Hiring profile · ${t.name}` : 'Hiring profile'}
      subtitle={t?.headline ?? undefined}
      onClose={onClose}
    >
      {error ? (
        <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>
      ) : !t ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
          <span className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
        </div>
      ) : (
        <div style={{ fontSize: 14 }}>
          <div style={line}>
            {[t.email, t.phone, t.location].filter(Boolean).join(' · ')}
          </div>
          {t.openTo.length > 0 && (
            <div style={{ ...line, marginTop: 4 }}>Open to: {t.openTo.map((o) => OPEN_TO_LABEL[o] ?? o).join(', ')}</div>
          )}
          {t.bio && <p style={{ marginTop: 10, whiteSpace: 'pre-line', lineHeight: 1.55 }}>{t.bio}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {t.cv ? (
              <Button variant="primary" size="sm" icon="download" onClick={() => openFile(t.cv!)}>
                Open CV
              </Button>
            ) : (
              <span style={line}>No CV uploaded</span>
            )}
            {t.visibility === 'LINK' && t.slug && (
              <Button
                variant="glass"
                size="sm"
                onClick={() => window.open(`https://portal.parttime.afrizonemart.com/p/${t.slug}`, '_blank', 'noopener')}
              >
                Public page
              </Button>
            )}
          </div>

          {head('Verified by AfriZone')}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <StatusPill
              variant={t.identityVerified ? 'ready' : 'pending'}
              label={t.identityVerified ? 'Identity checked' : 'Identity not checked'}
            />
            <span>
              <b>{t.workRecord.paidTasks}</b> paid tasks
              {t.workRecord.rating !== null && ` · ${t.workRecord.rating}★ (${t.workRecord.ratingsCount})`}
            </span>
          </div>
          {t.workRecord.byCategory.length > 0 && (
            <div style={{ ...line, marginTop: 6 }}>
              {t.workRecord.byCategory.map((c) => `${c.count} × ${c.category}`).join(' · ')}
            </div>
          )}

          {head('Certificates and licences')}
          {t.credentials.length === 0 ? (
            <div style={line}>None submitted</div>
          ) : (
            t.credentials.map((c) => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '4px 0' }}>
                <span>
                  <b>{c.title}</b> <span style={line}>· {c.type}{c.issuer ? ` · ${c.issuer}` : ''}</span>
                </span>
                <StatusPill
                  variant={c.verified ? 'ready' : c.status === 'REJECTED' ? 'danger' : 'review'}
                  label={c.verified ? 'Checked' : c.status === 'REJECTED' ? 'Rejected' : 'Not checked'}
                />
              </div>
            ))
          )}

          {head('Work history (self-declared)')}
          {t.experience.length === 0 ? (
            <div style={line}>None added</div>
          ) : (
            t.experience.map((e) => (
              <div key={e.id} style={{ padding: '4px 0' }}>
                <b>
                  {e.title} · {e.company}
                </b>
                <div style={line}>
                  {monthYear(e.startDate)} – {monthYear(e.endDate)}
                  {e.location ? ` · ${e.location}` : ''}
                </div>
                {e.description && <div style={{ whiteSpace: 'pre-line', marginTop: 2 }}>{e.description}</div>}
              </div>
            ))
          )}

          {head('Education (self-declared)')}
          {t.education.length === 0 ? (
            <div style={line}>None added</div>
          ) : (
            t.education.map((e) => (
              <div key={e.id} style={{ padding: '4px 0' }}>
                <b>
                  {e.qualification}
                  {e.field ? `, ${e.field}` : ''}
                </b>
                <div style={line}>
                  {e.institution}
                  {e.endYear ? ` · ${e.endYear}` : ''}
                </div>
              </div>
            ))
          )}

          {(t.portfolio.length > 0 || t.skills.length > 0) && head('Portfolio and skills (self-declared)')}
          {t.portfolio.map((p) => (
            <div key={p.id} style={{ padding: '4px 0', display: 'flex', gap: 10, alignItems: 'center' }}>
              <b>{p.title}</b>
              {p.url && (
                <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" style={{ color: 'var(--navy)' }}>
                  Link
                </a>
              )}
              {p.file && (
                <Button variant="glass" size="sm" onClick={() => openFile(p.file!)}>
                  File
                </Button>
              )}
            </div>
          ))}
          {t.skills.length > 0 && (
            <div style={{ ...line, marginTop: 6 }}>
              {t.skills.map((s) => `${s.name}${s.years ? ` (${s.years}y)` : ''}`).join(' · ')}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
