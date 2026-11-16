/**
 * Talent pools: named groups of workers HR keeps, e.g. "Verified Lagos
 * drivers" (server: routes/talentPools.ts). A job alert can go to one pool
 * from Hiring → Send job alert.
 */
import { useMemo, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useApi } from '../lib/useApi'
import { formatDate } from '../lib/format'
import type { TalentPool } from '../api/types'
import PageHeader from '../components/PageHeader'
import Glass from '../components/ui/Glass'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Input from '../components/ui/Input'
import Textarea from '../components/ui/Textarea'
import StatusPill from '../components/ui/StatusPill'
import Icon from '../components/Icon'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateView'
import { Label } from '@/components/shadcn/label'
import { Checkbox } from '@/components/shadcn/checkbox'

function errText(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

export default function TalentPools() {
  const { data, loading, error, reload } = useApi((signal) => api.talentPools(signal), [])
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState<TalentPool | 'new' | null>(null)

  const pools = data ?? []
  return (
    <>
      <PageHeader
        crumb="People / Talent pools"
        title="Talent pools"
        sub="Groups of workers you trust for a kind of work. Send a job alert to one pool from Hiring."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
            New pool
          </Button>
        }
      />

      {loading ? (
        <LoadingState label="Loading pools…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : pools.length === 0 ? (
        <Glass>
          <EmptyState
            icon="users"
            title="No pools yet"
            sub="Make one, e.g. “Verified Lagos drivers”, and add the workers you'd call first."
          />
        </Glass>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {pools.map((p) => (
            <Glass key={p.id}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <b style={{ fontSize: 15 }}>{p.name}</b>
                  {p.note && <div style={{ fontSize: 13, color: 'var(--muted)' }}>{p.note}</div>}
                </div>
                <span className="tnum" style={{ fontSize: 13 }}>
                  {p.memberCount} worker{p.memberCount === 1 ? '' : 's'}
                </span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>updated {formatDate(p.updatedAt)}</span>
                <Button variant="glass" size="sm" onClick={() => setEditing(p)}>
                  Rename
                </Button>
                <Button variant="primary" size="sm" onClick={() => setOpenId(p.id)}>
                  Open
                </Button>
              </div>
            </Glass>
          ))}
        </div>
      )}

      {editing && (
        <PoolForm
          pool={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            setEditing(null)
            reload()
            if (editing === 'new') setOpenId(id)
          }}
        />
      )}
      {openId && (
        <PoolDetail
          id={openId}
          onClose={() => {
            setOpenId(null)
            reload()
          }}
        />
      )}
    </>
  )
}

function PoolForm({
  pool,
  onClose,
  onSaved,
}: {
  pool: TalentPool | null
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const [name, setName] = useState(pool?.name ?? '')
  const [note, setNote] = useState(pool?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setErr(null)
    try {
      const saved = pool
        ? await api.updateTalentPool(pool.id, { name: name.trim(), note: note.trim() })
        : await api.createTalentPool(name.trim(), note.trim() || undefined)
      onSaved(saved.id)
    } catch (e) {
      setErr(errText(e, 'Could not save'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open title={pool ? 'Rename pool' : 'New talent pool'} onClose={onClose}>
      <div className="field">
        <Label htmlFor="pool-name">Name</Label>
        <Input id="pool-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Verified Lagos drivers" />
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <Label htmlFor="pool-note">Note (optional)</Label>
        <Textarea id="pool-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Who belongs here and why" />
      </div>
      {err && (
        <div className="login-error" role="alert" style={{ marginTop: 12 }}>
          <Icon name="alert" size={15} />
          {err}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
        <Button variant="glass" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={save}>
          Save
        </Button>
      </div>
    </Modal>
  )
}

const STANDING_PILL = {
  NEW: 'pending',
  BRONZE: 'pending',
  SILVER: 'ready',
  GOLD: 'ready',
} as const

function PoolDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: pool, loading, error, reload } = useApi((signal) => api.talentPool(id, signal), [id])
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function remove(userId: string) {
    setErr(null)
    try {
      await api.removeTalentPoolMember(id, userId)
      reload()
    } catch (e) {
      setErr(errText(e, 'Could not remove'))
    }
  }

  async function deletePool() {
    setErr(null)
    try {
      await api.deleteTalentPool(id)
      onClose()
    } catch (e) {
      setErr(errText(e, 'Could not delete'))
    }
  }

  return (
    <Modal open size="wide" title={pool?.name ?? 'Talent pool'} subtitle={pool?.note ?? undefined} onClose={onClose}>
      {loading && !pool ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : pool ? (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <Button variant="primary" size="sm" icon="plus" onClick={() => setAdding(true)}>
              Add workers
            </Button>
            <span style={{ flex: 1 }} />
            {confirmDelete ? (
              <>
                <span style={{ fontSize: 13 }}>Delete this pool? Workers are not affected.</span>
                <Button variant="danger" size="sm" onClick={deletePool}>
                  Delete
                </Button>
                <Button variant="glass" size="sm" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
              </>
            ) : (
              <Button variant="glass" size="sm" onClick={() => setConfirmDelete(true)}>
                Delete pool
              </Button>
            )}
          </div>
          {err && (
            <div className="login-error" role="alert" style={{ marginBottom: 12 }}>
              <Icon name="alert" size={15} />
              {err}
            </div>
          )}
          {pool.members.length === 0 ? (
            <EmptyState icon="users" title="Nobody in this pool yet" />
          ) : (
            <div style={{ display: 'grid', gap: 0 }}>
              {pool.members.map((m) => (
                <div
                  key={m.userId}
                  style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 13, padding: '8px 0', borderTop: '1px solid var(--line)' }}
                >
                  <b style={{ minWidth: 150 }}>{m.name}</b>
                  <span style={{ color: 'var(--muted)', flex: 1, minWidth: 160 }}>{[m.phone, m.email].filter(Boolean).join(' · ')}</span>
                  {m.standing && <StatusPill variant={STANDING_PILL[m.standing.level]} label={m.standing.label} />}
                  <span>KYC {m.kycStatus}</span>
                  {m.rating != null && <span className="tnum">★ {m.rating.toFixed(1)}</span>}
                  <Button variant="glass" size="sm" onClick={() => remove(m.userId)}>
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
          {adding && (
            <AddWorkers
              poolId={id}
              have={new Set(pool.members.map((m) => m.userId))}
              onClose={() => setAdding(false)}
              onAdded={() => {
                setAdding(false)
                reload()
              }}
            />
          )}
        </>
      ) : null}
    </Modal>
  )
}

/** Up to 90 a press: the server's per-request cap. */
const ADD_MAX = 90

function AddWorkers({
  poolId,
  have,
  onClose,
  onAdded,
}: {
  poolId: string
  have: Set<string>
  onClose: () => void
  onAdded: () => void
}) {
  const { data, loading, error, reload } = useApi((signal) => api.workers(signal), [])
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (data ?? [])
      .filter((w) => !have.has(w.id))
      .filter((w) => !needle || `${w.name} ${w.email}`.toLowerCase().includes(needle))
      .slice(0, 200)
  }, [data, q, have])

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < ADD_MAX) next.add(id)
      return next
    })
  }

  async function add() {
    setBusy(true)
    setErr(null)
    try {
      await api.addTalentPoolMembers(poolId, [...picked])
      onAdded()
    } catch (e) {
      setErr(errText(e, 'Could not add'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open title="Add workers" subtitle={`Pick up to ${ADD_MAX} at a time`} onClose={onClose}>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email" aria-label="Search workers" />
      <div style={{ maxHeight: 360, overflowY: 'auto', marginTop: 12 }}>
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : list.length === 0 ? (
          <EmptyState title="No workers match" />
        ) : (
          list.map((w) => (
            <label
              key={w.id}
              style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', fontSize: 13, borderTop: '1px solid var(--line)', cursor: 'pointer' }}
            >
              <Checkbox checked={picked.has(w.id)} onCheckedChange={() => toggle(w.id)} />
              <b style={{ minWidth: 140 }}>{w.name}</b>
              <span style={{ color: 'var(--muted)', flex: 1 }}>{w.email}</span>
              {w.standing && <span>{w.standing.label}</span>}
              <span>KYC {w.kycStatus}</span>
            </label>
          ))
        )}
      </div>
      {err && (
        <div className="login-error" role="alert" style={{ marginTop: 12 }}>
          <Icon name="alert" size={15} />
          {err}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
        <Button variant="glass" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" loading={busy} disabled={picked.size === 0} onClick={add}>
          Add {picked.size || ''}
        </Button>
      </div>
    </Modal>
  )
}
