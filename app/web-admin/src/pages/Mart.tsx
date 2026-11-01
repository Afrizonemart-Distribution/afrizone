import { useState } from 'react'
import { api, ApiError } from '../api/client'
import { useApi } from '../lib/useApi'
import { useAuth } from '../auth/AuthContext'
import { formatDateTime, formatNaira, martEventPill } from '../lib/format'
import type { DeliveryOfferRule, MartEventStatus, SurgeRule, TaskRule } from '../api/types'
import PageHeader from '../components/PageHeader'
import Glass from '../components/ui/Glass'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Select from '../components/ui/Select'
import Switch from '../components/ui/Switch'
import StatusPill from '../components/ui/StatusPill'
import Icon from '../components/Icon'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateView'
import { Label } from '@/components/shadcn/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/shadcn/table'
import './Mart.css'

/**
 * What AfriZoneMart has told us, and what the generators will do with the next
 * thing it tells us (Blueprint §5).
 *
 * This is the screen somebody opens when a task they expected does not exist.
 * The whole value of it is separating three answers that look identical from
 * the outside: Mart never sent it, we de-duplicated it, or we could not place
 * it.
 *
 * "Held for replay" is no longer produced by anything. It is the status every
 * order.confirmed carried before delivery was built, and those rows are real
 * orders that can still be replayed - so the filter stays. An empty count there
 * is the expected reading, not a broken one.
 */

type StatusFilter = MartEventStatus | 'ALL'

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'PROCESSED', label: 'Task created' },
  { key: 'DEFERRED', label: 'Held for replay' },
  { key: 'IGNORED', label: 'No new work' },
  { key: 'FAILED', label: 'Failed' },
]

/** Plain English for each status, shown under its count. */
const STATUS_MEANING: Record<MartEventStatus, string> = {
  PROCESSED: 'A task was created',
  DEFERRED: 'Understood and kept before delivery was built — still replayable',
  IGNORED: 'A duplicate, or no rule matched',
  FAILED: 'Could not be processed — these need a person',
}

const EVENT_TYPES: { key: string; label: string; makes: string }[] = [
  { key: 'ALL', label: 'All events', makes: '' },
  { key: 'order.confirmed', label: 'order.confirmed', makes: 'Delivery' },
  { key: 'stock.low', label: 'stock.low', makes: 'Sourcing' },
  { key: 'store.applied', label: 'store.applied', makes: 'Store audit' },
  { key: 'listing.needs_media', label: 'listing.needs_media', makes: 'Photography' },
]

/**
 * The rules, in the order an operator thinks about them: by the Mart event that
 * triggers each one. GENERAL is last because nothing from Mart uses it — it is
 * the fallback for a kind of work with no rule of its own.
 */
const RULE_KINDS: { kind: string; label: string; from: string }[] = [
  { kind: 'SOURCING', label: 'Sourcing', from: 'stock.low' },
  { kind: 'STORE_AUDIT', label: 'Store audit', from: 'store.applied' },
  { kind: 'MEDIA', label: 'Photography', from: 'listing.needs_media' },
  { kind: 'DELIVERY', label: 'Delivery', from: 'order.confirmed — once the store accepts' },
  { kind: 'GENERAL', label: 'General', from: 'fallback' },
]

const TIER_OPTIONS = [
  { value: 'STUDENT', label: 'Student' },
  { value: 'DISPATCH', label: 'Dispatch' },
  { value: 'REMOTE', label: 'Remote' },
  { value: 'PROMO', label: 'Promo' },
  { value: 'TRADE', label: 'Trade' },
]

export default function Mart() {
  const { user } = useAuth()
  const canEdit = user?.role === 'SUPER_ADMIN'

  const [status, setStatus] = useState<StatusFilter>('ALL')
  const [type, setType] = useState<string>('ALL')

  const { data, loading, error, reload } = useApi(
    (signal) => api.martEvents({ status, type }, signal),
    [status, type],
  )
  const rules = useApi((signal) => api.martRules(signal))

  const events = data?.events ?? []
  const counts = data?.counts ?? {}
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0)
  const filtered = status !== 'ALL' || type !== 'ALL'

  return (
    <>
      <PageHeader
        crumb="Operations / Mart"
        title="AfriZoneMart integration"
        sub="Mart sends facts. These are the facts it sent, what each one created, and the rules that decide what the next one creates."
        actions={
          <Button variant="glass" size="sm" icon="check" onClick={reload}>
            Refresh
          </Button>
        }
      />

      {/* Counts are tallied across every event, not the 200 shown below: the
          number that matters — how much is sitting deferred — is rarely on the
          first page. */}
      <div className="mart-counts" style={{ marginBottom: 18 }}>
        {(['PROCESSED', 'DEFERRED', 'IGNORED', 'FAILED'] as MartEventStatus[]).map((s) => (
          <Glass key={s} reveal className="mart-count">
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
              {STATUS_FILTERS.find((f) => f.key === s)?.label}
            </div>
            <div className="tnum" style={{ fontSize: 26, fontWeight: 700 }}>
              {counts[s] ?? 0}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: 1.4 }}>
              {STATUS_MEANING[s]}
            </div>
          </Glass>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            className={`btn btn-sm ${status === f.key ? 'btn-primary' : 'btn-glass'}`}
            onClick={() => setStatus(f.key)}
          >
            {f.label}
            {f.key !== 'ALL' && (counts[f.key as MartEventStatus] ?? 0) > 0 && (
              <span className="badge" style={{ marginLeft: 6 }}>
                {counts[f.key as MartEventStatus]}
              </span>
            )}
          </button>
        ))}
        <div style={{ minWidth: 200, marginLeft: 'auto' }}>
          <Select
            value={type}
            onChange={setType}
            options={EVENT_TYPES.map((t) => ({ value: t.key, label: t.label }))}
            ariaLabel="Filter by event type"
          />
        </div>
      </div>

      {loading ? (
        <LoadingState label="Loading events…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : events.length === 0 ? (
        <Glass>
          <EmptyState
            icon="inbox"
            title={filtered ? 'Nothing matches that filter' : 'Mart has not sent anything yet'}
            sub={
              filtered
                ? `${total} event${total === 1 ? '' : 's'} received in total.`
                : 'Events appear the moment Mart posts its first one. Until then this being empty is expected, not a fault.'
            }
          />
        </Glass>
      ) : (
        <Glass reveal delay="d1" className="tablewrap">
          <Table className="dt">
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>What happened</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Occurred</TableHead>
                <TableHead>Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e) => {
                const pill = martEventPill(e.status)
                return (
                  <TableRow key={e.id}>
                    <TableCell>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{e.type}</div>
                      {/* Mart's own id, and the only thing to quote when asking
                          them about a specific delivery. */}
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--muted)',
                          fontFamily: 'monospace',
                          maxWidth: 200,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={e.eventId}
                      >
                        {e.eventId}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span style={{ fontSize: 13, color: 'var(--text)' }}>
                        {e.note ?? (e.taskId ? 'Task created' : '—')}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                        <StatusPill variant={pill.variant} label={pill.label} />
                        {e.taskId && (
                          <a
                            href={`/tasks?task=${e.taskId}`}
                            style={{ fontSize: 11, color: 'var(--clay-deep)', fontWeight: 600 }}
                          >
                            View task
                          </a>
                        )}
                      </div>
                    </TableCell>
                    <TableCell style={{ color: 'var(--muted)', fontSize: 12 }}>
                      {formatDateTime(e.occurredAt)}
                    </TableCell>
                    <TableCell style={{ color: 'var(--muted)', fontSize: 12 }}>
                      {formatDateTime(e.receivedAt)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Glass>
      )}

      <div style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 18, marginBottom: 4 }}>Generation rules</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16, maxWidth: 620 }}>
          Mart sends facts, never task parameters — so raising a sourcing fee is a change here, not a
          change to Mart&apos;s code. These apply to the next event of each kind; tasks already created
          keep the terms they were created with.
        </p>

        {rules.loading ? (
          <LoadingState label="Loading rules…" />
        ) : rules.error ? (
          <ErrorState message={rules.error} onRetry={rules.reload} />
        ) : (
          <div className="mart-rules">
            {RULE_KINDS.map((k) => (
              <RuleCard
                key={k.kind}
                kind={k.kind}
                label={k.label}
                from={k.from}
                rule={rules.data!.kinds[k.kind]}
                canEdit={canEdit}
                onSaved={rules.reload}
              />
            ))}
            <OfferCard rule={rules.data!.offer} canEdit={canEdit} onSaved={rules.reload} />
            <SurgeCard
              rule={rules.data!.surge}
              baseFee={rules.data!.kinds.DELIVERY?.fee ?? 0}
              canEdit={canEdit}
              onSaved={rules.reload}
            />
          </div>
        )}
      </div>
    </>
  )
}

function RuleCard({
  kind,
  label,
  from,
  rule,
  canEdit,
  onSaved,
}: {
  kind: string
  label: string
  from: string
  rule?: TaskRule
  canEdit: boolean
  onSaved: () => void
}) {
  const [draft, setDraft] = useState<TaskRule | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (!rule) return null
  const value = draft ?? rule
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(rule)

  function set<K extends keyof TaskRule>(key: K, v: TaskRule[K]) {
    setDraft({ ...value, [key]: v })
  }

  async function save() {
    if (!draft) return
    setBusy(true)
    setErr(null)
    try {
      // Only what actually changed is written. A rule left alone must keep
      // falling back to its code default rather than being frozen into a
      // Setting row by the act of saving a neighbouring field.
      const writes: Promise<unknown>[] = []
      if (draft.fee !== rule!.fee) writes.push(api.putRule(kind, 'fee', String(draft.fee)))
      if (draft.tier !== rule!.tier) writes.push(api.putRule(kind, 'tier', draft.tier))
      if (draft.credentialSlug !== rule!.credentialSlug)
        writes.push(api.putRule(kind, 'credentialSlug', draft.credentialSlug))
      if (draft.windowDays !== rule!.windowDays)
        writes.push(api.putRule(kind, 'windowDays', String(draft.windowDays)))
      if (draft.requiresIdentityVerified !== rule!.requiresIdentityVerified)
        writes.push(
          api.putRule(kind, 'requiresIdentityVerified', String(draft.requiresIdentityVerified)),
        )
      await Promise.all(writes)
      setDraft(null)
      onSaved()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Glass reveal className="mart-rule">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
        <h3 style={{ fontSize: 15, margin: 0 }}>{label}</h3>
        <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{from}</span>
      </div>

      <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
        <div>
          <Label htmlFor={`${kind}-fee`}>Fee</Label>
          <Input
            id={`${kind}-fee`}
            type="number"
            min={0}
            value={String(value.fee)}
            disabled={!canEdit}
            onChange={(ev) => set('fee', Number(ev.target.value))}
          />
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            {formatNaira(value.fee)} per task
          </div>
        </div>

        <div>
          <Label htmlFor={`${kind}-tier`}>Tier</Label>
          <Select
            id={`${kind}-tier`}
            value={value.tier}
            onChange={(v) => set('tier', v)}
            options={TIER_OPTIONS}
            disabled={!canEdit}
            ariaLabel={`${label} tier`}
          />
        </div>

        <div>
          <Label htmlFor={`${kind}-cred`}>Required credential</Label>
          <Input
            id={`${kind}-cred`}
            value={value.credentialSlug}
            placeholder="none"
            disabled={!canEdit}
            onChange={(ev) => set('credentialSlug', ev.target.value.trim())}
          />
          {/* Empty is a real answer, not a missing one: it is how the gate is
              turned off. Saying so stops it reading as unconfigured. */}
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            {value.credentialSlug ? `Slug: ${value.credentialSlug}` : 'No credential gate'}
          </div>
        </div>

        <div>
          <Label htmlFor={`${kind}-window`}>Deadline</Label>
          <Input
            id={`${kind}-window`}
            type="number"
            min={1}
            value={String(value.windowDays)}
            disabled={!canEdit}
            onChange={(ev) => set('windowDays', Number(ev.target.value))}
          />
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            {value.windowDays} day{value.windowDays === 1 ? '' : 's'} from creation
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Switch
            checked={value.requiresIdentityVerified}
            onChange={(v) => set('requiresIdentityVerified', v)}
            disabled={!canEdit}
            label={`${label}: require verified identity`}
          />
          <span style={{ fontSize: 13 }}>Require verified identity</span>
        </div>
      </div>

      {err && (
        <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 10 }}>
          <Icon name="alert" size={14} /> {err}
        </div>
      )}

      {canEdit ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <Button variant="primary" size="sm" onClick={save} loading={busy} disabled={!dirty}>
            Save
          </Button>
          {dirty && (
            <Button variant="glass" size="sm" onClick={() => setDraft(null)} disabled={busy}>
              Discard
            </Button>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 14 }}>
          Only a super admin can change these.
        </div>
      )}
    </Glass>
  )
}

/**
 * How a delivery is offered to couriers, and when it stops being their problem
 * (MART_INTEGRATION.md §6 D4).
 *
 * These sit beside the generation rules because they are the same kind of thing
 * — Blueprint §5 asks that what the platform does with an event stays editable
 * by an admin rather than needing a deploy — but they are their own card,
 * because they apply to delivery alone. A claim radius means nothing for a
 * remote media task.
 *
 * THE RIGHT NUMBERS ARE NOT KNOWABLE YET. They are sized for a city motorcycle
 * courier, and nobody will know what they should be until a week of real orders
 * has been through. That is the whole reason they are on a screen.
 */
function OfferCard({
  rule,
  canEdit,
  onSaved,
}: {
  rule: DeliveryOfferRule
  canEdit: boolean
  onSaved: () => void
}) {
  const [draft, setDraft] = useState<DeliveryOfferRule | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const value = draft ?? rule
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(rule)

  function set<K extends keyof DeliveryOfferRule>(key: K, v: DeliveryOfferRule[K]) {
    setDraft({ ...value, [key]: v })
  }

  async function save() {
    if (!draft) return
    setBusy(true)
    setErr(null)
    try {
      // Only what changed, so a field left alone keeps falling back to its code
      // default rather than being frozen into a Setting row by the act of
      // saving a neighbouring one.
      const writes: Promise<unknown>[] = []
      if (draft.baseRadiusMetres !== rule.baseRadiusMetres)
        writes.push(api.putRule('DELIVERY', 'baseRadiusMetres', String(draft.baseRadiusMetres)))
      if (draft.stepMinutes !== rule.stepMinutes)
        writes.push(api.putRule('DELIVERY', 'radiusStepMinutes', String(draft.stepMinutes)))
      if (draft.maxRadiusMetres !== rule.maxRadiusMetres)
        writes.push(api.putRule('DELIVERY', 'maxRadiusMetres', String(draft.maxRadiusMetres)))
      if (draft.escalateAfterMinutes !== rule.escalateAfterMinutes)
        writes.push(
          api.putRule('DELIVERY', 'escalateAfterMinutes', String(draft.escalateAfterMinutes)),
        )
      if (draft.rankedCandidates !== rule.rankedCandidates)
        writes.push(api.putRule('DELIVERY', 'rankedCandidates', String(draft.rankedCandidates)))
      if (draft.rankedWindowMinutes !== rule.rankedWindowMinutes)
        writes.push(
          api.putRule('DELIVERY', 'rankedWindowMinutes', String(draft.rankedWindowMinutes)),
        )
      await Promise.all(writes)
      setDraft(null)
      onSaved()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  // The two numbers together rather than separately: neither the step nor the
  // ceiling means much on its own, and "reaches 15 km after 15 min" is the
  // sentence somebody is actually trying to tune.
  const doublings = Math.max(
    0,
    Math.ceil(Math.log2(value.maxRadiusMetres / Math.max(1, value.baseRadiusMetres))),
  )
  const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`)

  return (
    <Glass reveal className="mart-rule">
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}
      >
        <h3 style={{ fontSize: 15, margin: 0 }}>Delivery offer</h3>
        <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>
          order.confirmed
        </span>
      </div>

      {!rule.selfClaim && (
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
          Self-claim is switched off, so none of this is in force and every delivery waits for an
          approval. The switch is on Settings &rarr; Requirements.
        </p>
      )}

      <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
        {/* First, because it happens first: before the circle opens, the order
            goes to the best-placed online couriers one at a time. */}
        <div>
          <Label htmlFor="offer-ranked">Offer first to</Label>
          <Input
            id="offer-ranked"
            type="number"
            min={0}
            value={String(value.rankedCandidates)}
            disabled={!canEdit}
            onChange={(ev) => set('rankedCandidates', Number(ev.target.value))}
          />
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            {value.rankedCandidates > 0
              ? `The ${value.rankedCandidates} best-placed online couriers, one at a time, before anyone else`
              : 'Off: every order goes straight to the open circle'}
          </div>
        </div>

        {value.rankedCandidates > 0 && (
          <div>
            <Label htmlFor="offer-window">Each has it for</Label>
            <Input
              id="offer-window"
              type="number"
              min={1}
              value={String(value.rankedWindowMinutes)}
              disabled={!canEdit}
              onChange={(ev) => set('rankedWindowMinutes', Number(ev.target.value))}
            />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              {value.rankedWindowMinutes} min each &mdash; at most{' '}
              {value.rankedCandidates * value.rankedWindowMinutes} min before the circle below opens.
              Fewer online means fewer turns.
            </div>
          </div>
        )}

        <div>
          <Label htmlFor="offer-base">Opening radius</Label>
          <Input
            id="offer-base"
            type="number"
            min={1}
            value={String(value.baseRadiusMetres)}
            disabled={!canEdit}
            onChange={(ev) => set('baseRadiusMetres', Number(ev.target.value))}
          />
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            {km(value.baseRadiusMetres)} around the shop, at first
          </div>
        </div>

        <div>
          <Label htmlFor="offer-step">Widens every</Label>
          <Input
            id="offer-step"
            type="number"
            min={1}
            value={String(value.stepMinutes)}
            disabled={!canEdit}
            onChange={(ev) => set('stepMinutes', Number(ev.target.value))}
          />
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            Doubles every {value.stepMinutes} min &mdash; reaches {km(value.maxRadiusMetres)}{' '}
            {doublings * value.stepMinutes} min after it opens
          </div>
        </div>

        <div>
          <Label htmlFor="offer-max">Widest it gets</Label>
          <Input
            id="offer-max"
            type="number"
            min={1}
            value={String(value.maxRadiusMetres)}
            disabled={!canEdit}
            onChange={(ev) => set('maxRadiusMetres', Number(ev.target.value))}
          />
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            Past {km(value.maxRadiusMetres)} the answer is a person, not a wider circle
          </div>
        </div>

        <div>
          <Label htmlFor="offer-escalate">Flag it after</Label>
          <Input
            id="offer-escalate"
            type="number"
            min={1}
            value={String(value.escalateAfterMinutes)}
            disabled={!canEdit}
            onChange={(ev) => set('escalateAfterMinutes', Number(ev.target.value))}
          />
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            An unclaimed order shows on the deliveries board after {value.escalateAfterMinutes} min.
            It stays claimable while it is flagged.
          </div>
        </div>
      </div>

      {err && (
        <div className="login-error" role="alert" style={{ marginTop: 12 }}>
          {err}
        </div>
      )}

      {canEdit && dirty && (
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <Button size="sm" loading={busy} onClick={save}>
            Save
          </Button>
          <Button size="sm" variant="glass" onClick={() => setDraft(null)}>
            Cancel
          </Button>
        </div>
      )}
    </Glass>
  )
}

/**
 * Surge pay (Blueprint §10, server services/surge.ts): an unclaimed delivery
 * pays the courier more the longer it waits.
 *
 * Every naira of it is Afrizone's - the courier's pay is the task fee, not the
 * delivery fee Mart charges - so it is off until somebody types steps here.
 * The preview below works the steps through on the default fee, because
 * "10:10,20:25" is a setting and "₦150 more after 10 min" is a decision.
 */
function SurgeCard({
  rule,
  baseFee,
  canEdit,
  onSaved,
}: {
  rule: SurgeRule
  baseFee: number
  canEdit: boolean
  onSaved: () => void
}) {
  const [steps, setSteps] = useState<string | null>(null)
  const [max, setMax] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const stepsValue = steps ?? rule.stepsText
  const maxValue = max ?? String(rule.maxNaira || '')
  const dirty =
    (steps !== null && steps.trim() !== rule.stepsText) ||
    (max !== null && Number(max || 0) !== rule.maxNaira)

  // The same reading the server applies: steps that are not two positive
  // numbers, or that would pay less after a longer wait, are dropped.
  const parsed: { afterMinutes: number; percent: number }[] = []
  for (const part of stepsValue.split(',')) {
    const [m, p] = part.split(':').map((x) => Number(x.trim()))
    if (!Number.isFinite(m) || !Number.isFinite(p) || m <= 0 || p <= 0) continue
    parsed.push({ afterMinutes: m, percent: Math.min(p, 100) })
  }
  parsed.sort((a, b) => a.afterMinutes - b.afterMinutes)
  const clean: typeof parsed = []
  for (const st of parsed) {
    const last = clean[clean.length - 1]
    if (last && (st.afterMinutes === last.afterMinutes || st.percent <= last.percent)) continue
    clean.push(st)
  }
  const cap = Number(maxValue || 0)
  const extra = (pct: number) => {
    const a = Math.floor((baseFee * pct) / 100 / 50) * 50
    return cap > 0 ? Math.min(a, cap) : a
  }

  async function save() {
    setBusy(true)
    setErr(null)
    try {
      const writes: Promise<unknown>[] = []
      if (steps !== null && steps.trim() !== rule.stepsText)
        writes.push(api.putRule('DELIVERY', 'surgeSteps', steps.trim()))
      if (max !== null && Number(max || 0) !== rule.maxNaira)
        writes.push(api.putRule('DELIVERY', 'surgeMaxNaira', String(Number(max || 0))))
      await Promise.all(writes)
      setSteps(null)
      setMax(null)
      onSaved()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Glass reveal className="mart-rule">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
        <h3 style={{ fontSize: 15, margin: 0 }}>Surge pay</h3>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{rule.steps.length > 0 ? 'On' : 'Off'}</span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
        An unclaimed delivery pays the courier more the longer it waits. The extra comes out of
        Afrizone&rsquo;s margin, and the figure is locked in when a courier takes it.
      </p>

      <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
        <div>
          <Label htmlFor="surge-steps">Steps (minutes:percent)</Label>
          <Input
            id="surge-steps"
            value={stepsValue}
            placeholder="e.g. 10:10,20:25 — empty is off"
            disabled={!canEdit}
            onChange={(ev) => setSteps(ev.target.value)}
          />
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            {clean.length === 0
              ? 'Off: every delivery pays its fee and nothing more'
              : `On a ${formatNaira(baseFee)} delivery: ` +
                clean.map((s) => `+${formatNaira(extra(s.percent))} after ${s.afterMinutes} min`).join(', ')}
          </div>
        </div>
        <div>
          <Label htmlFor="surge-max">Never more than (₦ extra)</Label>
          <Input
            id="surge-max"
            type="number"
            min={0}
            value={maxValue}
            placeholder="No ceiling"
            disabled={!canEdit}
            onChange={(ev) => setMax(ev.target.value)}
          />
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            {cap > 0 ? `At most ${formatNaira(cap)} extra on any one order` : 'The highest step is the only limit'}
          </div>
        </div>
      </div>

      {err && (
        <div className="login-error" role="alert" style={{ marginTop: 12 }}>
          {err}
        </div>
      )}

      {canEdit && dirty && (
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <Button size="sm" loading={busy} onClick={save}>
            Save
          </Button>
          <Button
            size="sm"
            variant="glass"
            onClick={() => {
              setSteps(null)
              setMax(null)
            }}
          >
            Cancel
          </Button>
        </div>
      )}
    </Glass>
  )
}
