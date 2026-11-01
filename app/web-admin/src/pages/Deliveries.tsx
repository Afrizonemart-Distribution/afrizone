import { useState } from 'react'
import { api, ApiError } from '../api/client'
import { useApi } from '../lib/useApi'
import { useAuth } from '../auth/AuthContext'
import { formatDateTime, formatNaira } from '../lib/format'
import type { Delivery, DeliveryStatus } from '../api/types'
import PageHeader from '../components/PageHeader'
import Glass from '../components/ui/Glass'
import EvidenceButton from '../components/EvidenceButton'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import StatusPill from '../components/ui/StatusPill'
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
import './Deliveries.css'

/**
 * Every AfriZoneMart order, and what is holding each one up.
 *
 * THE QUESTION THIS SCREEN ANSWERS is "which orders are stuck, and on whom?" —
 * so the default view is the live ones and each row says who is being waited on
 * rather than only what state it is in. A board that shows every order ever
 * placed, newest first, is a log; an operator needs the four that are late.
 *
 * IT IS DELIBERATELY THIN ON ACTIONS. Staff can cancel an order and re-open one
 * a courier abandoned, and that is all. Accepting on a store's behalf happens on
 * the order itself and is recorded as having been done by staff; there is no
 * button here that quietly moves an order along, because every other transition
 * belongs to somebody — the shop, the rider, or the customer's code.
 */

type StatusFilter = DeliveryStatus | 'ALL' | 'LIVE' | 'ESCALATED'

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'LIVE', label: 'Live' },
  // MART_INTEGRATION.md §6 D4: the circle has widened as far as it is going to
  // and nobody has taken the job. This is the list an operator acts on.
  { key: 'ESCALATED', label: 'Nobody has taken it' },
  { key: 'RECEIVED', label: 'Waiting for the store' },
  { key: 'STORE_ACCEPTED', label: 'Waiting for a courier' },
  { key: 'PICKED_UP', label: 'Out for delivery' },
  { key: 'DELIVERED', label: 'Delivered' },
  { key: 'ALL', label: 'All' },
]

/**
 * DELIVERED is the only 'paid'-green state. STORE_REJECTED is not styled as a
 * failure — a shop that says it cannot fulfil an order has done the right thing,
 * and the failure would be finding that out from a courier at a closed door.
 */
function pill(d: Delivery): { variant: 'pending' | 'active' | 'review' | 'ready' | 'paid' | 'danger'; label: string } {
  switch (d.status) {
    case 'RECEIVED':
      return { variant: 'pending', label: d.statusLabel }
    case 'STORE_ACCEPTED':
      return { variant: 'review', label: d.preparedAt ? 'Packed, no courier' : d.statusLabel }
    case 'COURIER_ASSIGNED':
      return { variant: 'active', label: d.statusLabel }
    case 'PICKED_UP':
      return { variant: 'active', label: d.statusLabel }
    case 'DELIVERED':
      return { variant: 'paid', label: d.statusLabel }
    case 'STORE_REJECTED':
      return { variant: 'review', label: d.statusLabel }
    case 'FAILED':
      return { variant: 'danger', label: d.statusLabel }
    case 'CANCELLED':
      return { variant: 'pending', label: d.statusLabel }
    default:
      return { variant: 'pending', label: d.statusLabel }
  }
}

/**
 * Who the order is waiting on, in the words an operator would use to chase it.
 *
 * This is the column that makes the board worth opening. A status tells you the
 * state; this tells you who to telephone.
 */
function waitingOn(d: Delivery): string {
  const base = waitingOnBase(d)
  // Surge said in the same breath, because it is the other half of "why has
  // nobody taken it?" - and once taken, what it cost.
  if (!d.surge || d.surge.amount <= 0) return base
  return d.surge.locked
    ? `${base} · taken at +${formatNaira(d.surge.amount)} surge`
    : `${base} · paying +${formatNaira(d.surge.amount)} surge`
}

function waitingOnBase(d: Delivery): string {
  switch (d.status) {
    case 'RECEIVED':
      return `${d.storeName ?? 'The store'} has not answered`
    case 'STORE_ACCEPTED':
      // The offer label is the server's sentence and says how long it has been
      // on the board. It is more use than "waiting for a courier", which an
      // operator can already see from the state column.
      if (d.offer?.escalated) return d.offer.label
      return d.preparedAt ? 'Packed and waiting for a courier' : 'The store is packing it'
    case 'COURIER_ASSIGNED':
      return 'The courier has not collected yet'
    case 'PICKED_UP':
      return 'With the courier, waiting on the customer code'
    case 'STORE_REJECTED':
      return d.storeNote ? `Refused: ${d.storeNote}` : 'The store refused it'
    case 'FAILED':
      return d.failureReason ?? 'Attempted and not completed'
    case 'CANCELLED':
      return 'Called off'
    case 'DELIVERED':
      return '—'
    default:
      return '—'
  }
}

/** How long an order has been sitting where it is. Blank once it is finished. */
function waitingFor(d: Delivery): string {
  const LIVE: DeliveryStatus[] = ['RECEIVED', 'STORE_ACCEPTED', 'COURIER_ASSIGNED', 'PICKED_UP']
  if (!LIVE.includes(d.status)) return ''
  const since = new Date(
    d.pickedUpAt ?? d.assignedAt ?? d.storeDecidedAt ?? d.createdAt,
  ).getTime()
  const mins = Math.floor((Date.now() - since) / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export default function Deliveries() {
  const { user } = useAuth()
  const canPurge = user?.role === 'SUPER_ADMIN'

  const [filter, setFilter] = useState<StatusFilter>('LIVE')
  const [acting, setActing] = useState<{ d: Delivery; what: 'cancel' | 'reopen' } | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const { data, loading, error, reload } = useApi(
    (signal) =>
      api.deliveries(
        filter === 'LIVE'
          ? { stuck: true }
          : filter === 'ESCALATED'
            ? { escalated: true }
            : { status: filter === 'ALL' ? 'ALL' : filter },
        signal,
      ),
    [filter],
  )
  const purge = useApi((signal) => api.purgeStatus(signal))

  const rows = data?.deliveries ?? []

  async function act() {
    if (!acting) return
    setBusy(true)
    setActionError(null)
    try {
      if (acting.what === 'cancel') await api.cancelDelivery(acting.d.id, reason.trim())
      else await api.reopenDelivery(acting.d.id, reason.trim())
      setActing(null)
      setReason('')
      reload()
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Could not do that.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        crumb="Operations / Deliveries"
        title="Deliveries"
        sub="Every order AfriZoneMart has confirmed, and who each one is waiting on."
        actions={
          <Button variant="glass" size="sm" icon="check" onClick={reload}>
            Refresh
          </Button>
        }
      />

      {/* An order that cannot be completed because nobody wired up the verifier
          looks exactly like a courier who has not turned up. Saying which is
          the difference between chasing a rider and filing a ticket. */}
      {data && !data.martConfigured && (
        <Glass className="dv-warn" reveal>
          <b>Deliveries cannot be completed yet.</b>
          <p>
            AfriZoneMart has not given us the endpoint that checks a customer&apos;s code, so
            <code> MART_BASE_URL </code> and <code>MART_OUTBOUND_SECRET</code> are unset. Orders
            can be accepted, posted and collected; the last step will tell the courier we could
            not check the code, which is the intended behaviour rather than a fault to debug.
          </p>
        </Glass>
      )}

      {/* The other half of D4. A widening circle can only do so much, and past
          the threshold the answer is a person - so the board says so, with the
          count over the whole board rather than the current filter. */}
      {data && data.escalatedCount > 0 && filter !== 'ESCALATED' && (
        <Glass className="dv-warn" reveal>
          <b>
            {data.escalatedCount} {data.escalatedCount === 1 ? 'order has' : 'orders have'} been
            waiting too long for a courier.
          </b>
          <p>
            Nobody has taken {data.escalatedCount === 1 ? 'it' : 'them'} and the circle
            {data.escalatedCount === 1 ? ' it is' : ' they are'} offered in has stopped widening.
            <button className="btn btn-sm btn-glass dv-inline" onClick={() => setFilter('ESCALATED')}>
              Show {data.escalatedCount === 1 ? 'it' : 'them'}
            </button>
          </p>
        </Glass>
      )}

      {/* Worth knowing before chasing riders who are not being offered
          anything: with self-claim off, every order waits on an approval. */}
      {data && !data.selfClaim && (
        <Glass className="dv-warn" reveal>
          <b>Couriers cannot take jobs themselves.</b>
          <p>
            Self-claim is switched off, so every delivery waits for somebody to approve an
            application. Turn it back on in Settings &rarr; Requirements
            (<code>rules.DELIVERY.selfClaim</code>).
          </p>
        </Glass>
      )}

      <div className="dv-filters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`btn btn-sm ${filter === f.key ? 'btn-primary' : 'btn-glass'}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingState label="Loading orders…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : rows.length === 0 ? (
        <Glass>
          <EmptyState
            icon="send"
            title={
              filter === 'LIVE'
                ? 'Nothing is waiting'
                : filter === 'ESCALATED'
                  ? 'Every order has found a courier'
                  : 'No orders match that'
            }
            sub={
              filter === 'LIVE'
                ? 'Every order has either been delivered or closed. This being empty is the good outcome.'
                : filter === 'ESCALATED'
                  ? 'Nothing has been sitting on the board past its escalation window. This being empty is the good outcome.'
                  : 'Try a different filter, or All.'
            }
          />
        </Glass>
      ) : (
        <Glass reveal delay="d1" className="tablewrap">
          <Table className="dt">
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Store</TableHead>
                <TableHead>Waiting on</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Confirmed</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => {
                const p = pill(d)
                const age = waitingFor(d)
                return (
                  <TableRow key={d.id}>
                    <TableCell>
                      <div className="dv-order">{d.martOrderId}</div>
                      <div className="dv-sub">
                        {/* CONSIGNMENT owes the store nothing extra; OWN_STOCK
                            becomes a settlement line. It is the field the whole
                            integration document exists for, so it is on screen. */}
                        {d.stockSource === 'OWN_STOCK' ? 'Store’s own stock' : 'Consignment'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div style={{ fontSize: 13 }}>{d.storeName ?? '—'}</div>
                      {d.pickupAddress && <div className="dv-sub">{d.pickupAddress}</div>}
                    </TableCell>
                    <TableCell>
                      <span style={{ fontSize: 13 }}>{waitingOn(d)}</span>
                      {age && <span className="dv-age">· {age}</span>}
                    </TableCell>
                    <TableCell>
                      <StatusPill variant={p.variant} label={p.label} />
                    </TableCell>
                    <TableCell className="tnum" style={{ fontSize: 13 }}>
                      {formatNaira(d.goodsTotal)}
                    </TableCell>
                    <TableCell style={{ color: 'var(--muted)', fontSize: 12 }}>
                      {formatDateTime(d.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="dv-acts">
                        {d.status === 'COURIER_ASSIGNED' && (
                          <button
                            className="btn btn-sm btn-glass"
                            onClick={() => {
                              setActing({ d, what: 'reopen' })
                              setReason('')
                            }}
                          >
                            Re-open
                          </button>
                        )}
                        {['RECEIVED', 'STORE_ACCEPTED', 'COURIER_ASSIGNED', 'PICKED_UP'].includes(
                          d.status,
                        ) && (
                          <button
                            className="btn btn-sm btn-glass"
                            onClick={() => {
                              setActing({ d, what: 'cancel' })
                              setReason('')
                            }}
                          >
                            Cancel
                          </button>
                        )}
                        {d.taskId && d.status !== 'STORE_ACCEPTED' && d.status !== 'RECEIVED' && (
                          <EvidenceButton taskId={d.taskId} />
                        )}
                        {d.taskId && (
                          <a className="dv-link" href={`/tasks?task=${d.taskId}`}>
                            Task
                          </a>
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

      {/* ── Retention ───────────────────────────────────────────────────────
          MART_INTEGRATION.md §5: the customer's name, number and door are
          deleted seven days after an order finishes, and "the purge is auditable
          and its failure visible". This is the visible part. Without it, a cron
          that stopped firing in March is discovered by somebody asking an
          awkward question in November. */}
      <div className="dv-purge-wrap">
        <h2>Customer data</h2>
        <p>
          A delivery gives us a name, a number and a door. We delete them seven days after the
          order finishes — actually delete, not hide — and this is how you check that is
          happening.
        </p>

        {purge.loading ? (
          <LoadingState label="Checking…" />
        ) : purge.error ? (
          <ErrorState message={purge.error} onRetry={purge.reload} />
        ) : purge.data ? (
          <Glass className="dv-purge" reveal>
            <div className="dv-purge-grid">
              <div>
                <div className="dv-sub">Waiting to be deleted</div>
                <div className="tnum dv-big">{purge.data.due}</div>
              </div>
              <div>
                <div className="dv-sub">Already deleted</div>
                <div className="tnum dv-big">{purge.data.purgedTotal}</div>
              </div>
              <div>
                <div className="dv-sub">Last run</div>
                <div className="dv-when">
                  {purge.data.lastRunAt ? (
                    formatDateTime(purge.data.lastRunAt)
                  ) : (
                    // Never having run is a different problem from a backlog,
                    // and the one worth shouting about.
                    <span style={{ color: 'var(--danger)' }}>Never</span>
                  )}
                </div>
              </div>
            </div>
            <p className="dv-sub" style={{ marginTop: 14 }}>
              The sweep runs daily on its own. A backlog here means it is behind, not that it is
              broken — it drains over consecutive runs.
              {canPurge && ' You can also run it now.'}
            </p>
            {canPurge && (
              <Button
                variant="glass"
                size="sm"
                icon="check"
                onClick={async () => {
                  await api.runPurge().catch(() => undefined)
                  purge.reload()
                }}
              >
                Run it now
              </Button>
            )}
          </Glass>
        ) : null}
      </div>

      <Modal
        open={acting !== null}
        title={acting?.what === 'cancel' ? 'Cancel this order' : 'Put it back on the board'}
        subtitle={
          acting?.what === 'cancel'
            ? 'Terminal. AfriZoneMart is not told, because an order called off was called off by one of us and both already know.'
            : 'For a courier who accepted and then disappeared. The posting re-opens and anybody qualified can take it.'
        }
        onClose={() => setActing(null)}
      >
        <Label htmlFor="dv-reason">Reason</Label>
        <Input
          id="dv-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={
            acting?.what === 'cancel'
              ? 'Customer cancelled with Mart'
              : 'Unreachable for two hours'
          }
          style={{ marginTop: 6 }}
        />
        {actionError && <ErrorState message={actionError} />}
        <div className="dv-modal-acts">
          <Button variant="glass" onClick={() => setActing(null)}>
            Back
          </Button>
          <Button variant="primary" loading={busy} disabled={reason.trim().length === 0} onClick={act}>
            {acting?.what === 'cancel' ? 'Cancel the order' : 'Re-open it'}
          </Button>
        </div>
      </Modal>
    </>
  )
}
