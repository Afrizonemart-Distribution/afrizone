/**
 * Settings > Tiers and Settings > Countries (server: routes/places.ts).
 *
 * Tiers: the five built-ins plus any you add. A tier is switched off, never
 * deleted, because tasks and Partimers keep pointing at it.
 *
 * Countries: Nigeria is live; the rest of Africa is listed as coming soon and
 * shows that way wherever a country is picked. Switching one on opens it.
 */
import { useState } from 'react'
import { api, ApiError } from '../api/client'
import type { TierRow } from '../api/types'
import { useApi } from '../lib/useApi'
import { useTiers } from '../lib/tiers'
import Glass from '../components/ui/Glass'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Switch from '../components/ui/Switch'
import { ErrorState, LoadingState } from '../components/ui/StateView'
import { Label } from '@/components/shadcn/label'

const BUILT_IN = ['STUDENT', 'DISPATCH', 'REMOTE', 'PROMO', 'TRADE']

export function TiersTab({ canEdit }: { canEdit: boolean }) {
  const { all, reload } = useTiers()
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [docLabel, setDocLabel] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState<TierRow | null>(null)

  async function add() {
    setBusy('new')
    setErr(null)
    try {
      await api.createTier({ label: label.trim(), description: description.trim(), docLabel: docLabel.trim() })
      setLabel('')
      setDescription('')
      setDocLabel('')
      reload()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not add the tier')
    } finally {
      setBusy(null)
    }
  }

  async function save(t: TierRow, body: Partial<Omit<TierRow, 'key'>>) {
    setBusy(t.key)
    setErr(null)
    try {
      await api.patchTier(t.key, body)
      setEditing(null)
      reload()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not save')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="tabhead">
        <p className="tabhint">
          A tier is the kind of work a Partimer is cleared for. Tasks are posted to one tier, and only Partimers in it see
          them.
        </p>
      </div>
      {err && (
        <div className="login-error" role="alert">
          {err}
        </div>
      )}
      {canEdit && (
        <Glass>
          <h3 style={{ fontSize: 15, margin: '0 0 12px' }}>Add a tier</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div className="field">
              <Label htmlFor="tier-label">Name</Label>
              <Input id="tier-label" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder="Field sales" />
            </div>
            <div className="field">
              <Label htmlFor="tier-desc">What it covers</Label>
              <Input
                id="tier-desc"
                value={description}
                maxLength={200}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Door-to-door and market sales."
              />
            </div>
            <div className="field">
              <Label htmlFor="tier-doc">What a Partimer shows to qualify</Label>
              <Input
                id="tier-doc"
                value={docLabel}
                maxLength={120}
                onChange={(e) => setDocLabel(e.target.value)}
                placeholder="Reference from a past sales job"
              />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <Button size="sm" loading={busy === 'new'} disabled={label.trim().length < 2} onClick={add}>
              Add tier
            </Button>
          </div>
        </Glass>
      )}
      <Glass>
        <div style={{ display: 'grid', gap: 10 }}>
          {all.map((t) => (
            <div key={t.key} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                {editing?.key === t.key ? (
                  <div style={{ display: 'grid', gap: 6 }}>
                    <Input value={editing.label} maxLength={40} onChange={(e) => setEditing({ ...editing, label: e.target.value })} />
                    <Input
                      value={editing.description ?? ''}
                      placeholder="What it covers"
                      maxLength={200}
                      onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                    />
                    <Input
                      value={editing.docLabel ?? ''}
                      placeholder="What a Partimer shows to qualify"
                      maxLength={120}
                      onChange={(e) => setEditing({ ...editing, docLabel: e.target.value })}
                    />
                  </div>
                ) : (
                  <>
                    <b>{t.label}</b>
                    {BUILT_IN.includes(t.key) && (
                      <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>built in</span>
                    )}
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {[t.description, t.docLabel && `Shows: ${t.docLabel}`].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </>
                )}
              </div>
              {canEdit &&
                (editing?.key === t.key ? (
                  <>
                    <Button variant="glass" size="sm" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      loading={busy === t.key}
                      disabled={editing.label.trim().length < 2}
                      onClick={() =>
                        save(t, { label: editing.label, description: editing.description ?? '', docLabel: editing.docLabel ?? '' })
                      }
                    >
                      Save
                    </Button>
                  </>
                ) : (
                  <Button variant="glass" size="sm" onClick={() => setEditing(t)}>
                    Edit
                  </Button>
                ))}
              <Switch
                checked={t.active}
                onChange={(next) => save(t, { active: next })}
                disabled={!canEdit || busy === t.key}
                label={`${t.label} switched on`}
              />
            </div>
          ))}
        </div>
      </Glass>
    </div>
  )
}

export function CountriesTab({ canEdit }: { canEdit: boolean }) {
  const { data, loading, error, reload } = useApi((signal) => api.places(signal))
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  if (loading) return <LoadingState label="Loading countries…" />
  if (error) return <ErrorState message={error} onRetry={reload} />

  async function toggle(code: string, live: boolean) {
    setBusy(code)
    setErr(null)
    try {
      await api.setCountryLive(code, live)
      reload()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not change it')
    } finally {
      setBusy(null)
    }
  }

  const countries = data?.countries ?? []
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="tabhead">
        <p className="tabhint">
          Part Time starts in Nigeria. Every other African country is listed as coming soon, shown that way to admins and
          Partimers, and cannot be picked until you switch it on here.
        </p>
      </div>
      {err && (
        <div className="login-error" role="alert">
          {err}
        </div>
      )}
      <Glass>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
          {countries.map((c) => (
            <div key={c.code} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span>
                {c.name}{' '}
                <span style={{ fontSize: 11, color: c.live ? 'var(--money)' : 'var(--muted)' }}>
                  {c.live ? 'Live' : 'Coming soon'}
                </span>
              </span>
              <Switch
                checked={c.live}
                onChange={(next) => toggle(c.code, next)}
                disabled={!canEdit || busy === c.code}
                label={`${c.name} live`}
              />
            </div>
          ))}
        </div>
      </Glass>
    </div>
  )
}
