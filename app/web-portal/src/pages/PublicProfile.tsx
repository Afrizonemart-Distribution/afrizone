import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Shell, { ErrorNote } from './Shell'
import { api, ApiError } from '../lib/api'
import type { PublicProfile } from '../lib/types'
import './PublicProfile.css'

/**
 * /p/:slug, a Talent Profile its owner chose to share.
 *
 * The server sends only the public cut (no contact details, no files, only
 * checked certificates). This page's job is to keep the three kinds of fact
 * visibly apart, because that difference is the whole value of the profile:
 *   proven by AfriZone  >  checked documents  >  the person's own word.
 *
 * Not indexed by search engines: sharing a link is not publishing to Google.
 */

const OPEN_TO_LABEL: Record<string, string> = {
  TASKS: 'one-off tasks',
  HOURLY: 'hourly work',
  CONTRACT: 'contract roles',
  FULL_TIME: 'full-time jobs',
}

const monthYear = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'Present'

export default function PublicProfilePage() {
  const { slug = '' } = useParams()
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    setProfile(null)
    setError(null)
    api
      .publicProfile(slug, ctrl.signal)
      .then((p) => {
        setProfile(p)
        document.title = `${p.name} · AfriZone Part-Time`
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return
        setError(
          e instanceof ApiError && e.status === 404
            ? 'This profile is not shared, or the link is wrong.'
            : e instanceof Error
              ? e.message
              : 'Could not load this profile.',
        )
      })
    return () => ctrl.abort()
  }, [slug])

  return (
    <Shell>
      <div className="pp">
        {error ? (
          <div className="card">
            <ErrorNote message={error} />
            <p className="hint" style={{ marginTop: 12 }}>
              Looking for work? <Link to="/">Join AfriZone Part-Time</Link>
            </p>
          </div>
        ) : !profile ? (
          <div className="card pp-loading" aria-busy="true">
            Loading profile…
          </div>
        ) : (
          <>
            <section className="card pp-head">
              <p className="eyebrow">AfriZone Part-Time profile</p>
              <h1 className="pt">{profile.name}</h1>
              {profile.headline && <p className="pp-headline">{profile.headline}</p>}
              {profile.location && <p className="hint">{profile.location}</p>}
              {profile.openTo.length > 0 && (
                <div className="pp-chips">
                  {profile.openTo.map((o) => (
                    <span key={o} className="pp-chip">
                      Open to {OPEN_TO_LABEL[o] ?? o}
                    </span>
                  ))}
                </div>
              )}
              {profile.bio && <p className="pp-bio">{profile.bio}</p>}
            </section>

            <section className="card pp-proven">
              <h2>Verified by AfriZone</h2>
              <ul className="pp-facts">
                <li className={profile.identityVerified ? 'ok' : ''}>
                  {profile.identityVerified ? 'Identity checked' : 'Identity not yet checked'}
                </li>
                <li className={profile.workRecord.paidTasks ? 'ok' : ''}>
                  {profile.workRecord.paidTasks} paid {profile.workRecord.paidTasks === 1 ? 'task' : 'tasks'} completed
                </li>
                {profile.workRecord.rating !== null && (
                  <li className="ok">
                    Rated {profile.workRecord.rating}★ by {profile.workRecord.ratingsCount}{' '}
                    {profile.workRecord.ratingsCount === 1 ? 'manager' : 'managers'}
                  </li>
                )}
                <li>Member since {monthYear(profile.memberSince)}</li>
              </ul>
              {profile.workRecord.byCategory.length > 0 && (
                <div className="pp-chips">
                  {profile.workRecord.byCategory.map((c) => (
                    <span key={c.category} className="pp-chip ok">
                      {c.count} × {c.category}
                    </span>
                  ))}
                </div>
              )}
              <p className="hint">Built from paid work on AfriZone. Nobody can edit it.</p>
            </section>

            {profile.credentials.length > 0 && (
              <section className="card">
                <h2>Checked certificates and licences</h2>
                <ul className="pp-list">
                  {profile.credentials.map((c) => (
                    <li key={c.id}>
                      <b>{c.title}</b>
                      <span>
                        {c.type}
                        {c.issuer ? ` · ${c.issuer}` : ''}
                        {c.expiresAt ? ` · valid to ${monthYear(c.expiresAt)}` : ''}
                      </span>
                      <span className="pill ok">Checked by AfriZone</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {profile.experience.length > 0 && (
              <section className="card">
                <h2>Work history</h2>
                <ul className="pp-list">
                  {profile.experience.map((e) => (
                    <li key={e.id}>
                      <b>
                        {e.title} · {e.company}
                      </b>
                      <span>
                        {monthYear(e.startDate)} – {monthYear(e.endDate)}
                        {e.location ? ` · ${e.location}` : ''}
                      </span>
                      {e.description && <p>{e.description}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {profile.education.length > 0 && (
              <section className="card">
                <h2>Education</h2>
                <ul className="pp-list">
                  {profile.education.map((e) => (
                    <li key={e.id}>
                      <b>
                        {e.qualification}
                        {e.field ? `, ${e.field}` : ''}
                      </b>
                      <span>
                        {e.institution}
                        {e.endYear ? ` · ${e.endYear}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {(profile.skills.length > 0 || profile.portfolio.some((p) => p.url)) && (
              <section className="card">
                {profile.skills.length > 0 && (
                  <>
                    <h2>Skills</h2>
                    <div className="pp-chips">
                      {profile.skills.map((s) => (
                        <span key={s.name} className="pp-chip">
                          {s.name}
                          {s.years ? ` · ${s.years}y` : ''}
                        </span>
                      ))}
                    </div>
                  </>
                )}
                {profile.portfolio.some((p) => p.url) && (
                  <>
                    <h2 style={{ marginTop: profile.skills.length ? 20 : 0 }}>Portfolio</h2>
                    <ul className="pp-list">
                      {profile.portfolio
                        .filter((p) => p.url)
                        .map((p) => (
                          <li key={p.id}>
                            <a href={p.url!} target="_blank" rel="noopener noreferrer nofollow ugc">
                              {p.title}
                            </a>
                            {p.description && <span>{p.description}</span>}
                          </li>
                        ))}
                    </ul>
                  </>
                )}
              </section>
            )}

            <p className="hint pp-foot">
              Work history, education, portfolio and skills are as stated by the person. Only items marked as checked
              have been verified by AfriZone.
            </p>
          </>
        )}
      </div>
    </Shell>
  )
}
