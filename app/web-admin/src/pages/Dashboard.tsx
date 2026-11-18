import { lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../lib/useApi'
import { formatNaira, formatNairaCompact } from '../lib/format'
import Glass from '../components/ui/Glass'
import Button from '../components/ui/Button'
import KpiCard from '../components/ui/KpiCard'
import Icon, { type IconName } from '../components/Icon'
import { ErrorState, LoadingState } from '../components/ui/StateView'
import type { DashboardActivity, DashboardStats } from '../api/types'
import './Dashboard.css'
import { Skeleton } from '@/components/shadcn/skeleton'

/**
 * The operations dashboard (server: routes/dashboard.ts). Every figure is
 * counted from the database; nothing here is a fixed label.
 */

/* Lazy so the charting library stays out of the first paint of the landing route. */
const CategoryBars = lazy(() => import('../components/chart-views').then((m) => ({ default: m.CategoryBars })))
const FillRateMeter = lazy(() => import('../components/chart-views').then((m) => ({ default: m.FillRateMeter })))

const ATTENTION_ICON: Record<string, { icon: IconName; color: string }> = {
  payments: { icon: 'card', color: 'var(--money)' },
  withdrawals: { icon: 'naira', color: 'var(--money)' },
  applications: { icon: 'file', color: 'var(--clay)' },
  timesheets: { icon: 'clock', color: 'var(--amber)' },
  kyc: { icon: 'users', color: 'var(--indigo)' },
  identity: { icon: 'shield', color: 'var(--danger)' },
  dispute: { icon: 'alert', color: 'var(--danger)' },
}

const ACTIVITY_ICON: Record<string, { icon: IconName; color: string }> = {
  user: { icon: 'users', color: 'var(--indigo)' },
  apply: { icon: 'arrow-up', color: 'var(--clay)' },
  check: { icon: 'check', color: 'var(--money)' },
  payment: { icon: 'card', color: 'var(--money)' },
  payout: { icon: 'naira', color: 'var(--gold)' },
}

function ActivityRow({ item }: { item: DashboardActivity }) {
  const meta = ACTIVITY_ICON[item.icon] ?? { icon: 'check' as IconName, color: 'var(--money)' }
  return (
    <div className="frow">
      <span className="fi" style={{ color: meta.color }}>
        <Icon name={meta.icon} strokeWidth={2.2} />
      </span>
      <div className="ft">
        <b>{item.title}</b>
        <span>{item.sub}</span>
      </div>
      <span className="fm">{item.ago}</span>
    </div>
  )
}

function StateList({ rows, unit }: { rows: { state: string; count: number }[]; unit: string }) {
  if (rows.length === 0) return <div className="frow" style={{ color: 'var(--muted)' }}>None yet.</div>
  const max = Math.max(...rows.map((r) => r.count))
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map((r) => (
        <div key={r.state}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span>{r.state}</span>
            <b>
              {r.count} {unit}
            </b>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--line-2)', marginTop: 4 }}>
            <div style={{ width: `${(r.count / max) * 100}%`, height: 6, borderRadius: 3, background: 'var(--clay)' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** The figures as a CSV, for the Export button. */
function exportCsv(d: DashboardStats) {
  const rows: (string | number)[][] = [
    ['Figure', 'Value'],
    ['Partimers', d.partimers.total],
    ['Verified Partimers', d.partimers.verified],
    ['New Partimers this month', d.partimers.newThisMonth],
    ['Partimers working now', d.partimers.workingNow],
    ['Open tasks', d.tasks.open],
    ['Unfilled places', d.tasks.openSlots],
    ['Tasks posted this month', d.tasks.createdThisMonth],
    ['Fill rate this month (%)', d.tasks.fillRate ?? ''],
    ['Avg time to fill (h)', d.tasks.avgTimeToFillHours ?? ''],
    ['Earned this month (NGN)', d.money.earnedThisMonth],
    ['Paid out this month (NGN)', d.money.paidOutThisMonth],
    ['Owed to Partimers (NGN)', d.money.owedToPartimers],
    ...d.partimersByState.map((r) => [`Partimers in ${r.state}`, r.count]),
  ]
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = `parttime-dashboard-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { data, loading, error, reload } = useApi((signal) => api.dashboardStats(signal))

  if (loading) return <LoadingState label="Loading dashboard…" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return null

  const { partimers, tasks, money } = data
  const waiting = data.attention.reduce((n, a) => n + a.count, 0)

  return (
    <>
      <div className="phead rv in">
        <div>
          <span className="chip">
            <span className="pulse" />
            Live · {data.liveIn.length ? data.liveIn.join(', ') : 'nowhere yet'}
          </span>
          <h1 style={{ marginTop: 12 }}>Operations dashboard</h1>
          <div className="crumb">
            {waiting === 0 ? 'Nothing waiting on you' : `${waiting} thing${waiting === 1 ? '' : 's'} waiting on you`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button variant="glass" size="sm" icon="download" onClick={() => exportCsv(data)}>
            Export
          </Button>
          <Button variant="primary" size="sm" icon="arrow-right" onClick={() => navigate('/tasks')}>
            Post a task
          </Button>
        </div>
      </div>

      <div className="kpis">
        <KpiCard
          tone="k1"
          icon="users"
          iconColor="var(--indigo)"
          label="Partimers"
          value={partimers.total}
          delta={`${partimers.verified} verified · ${partimers.newThisMonth} new this month`}
        />
        <KpiCard
          tone="k2"
          icon="briefcase"
          iconColor="var(--clay)"
          label="Working now"
          value={partimers.workingNow}
          delta={`${tasks.open} open task${tasks.open === 1 ? '' : 's'} · ${tasks.openSlots} place${tasks.openSlots === 1 ? '' : 's'} to fill`}
          delay="d1"
        />
        <KpiCard
          tone="k3"
          icon="check-circle"
          iconColor="var(--money)"
          label="Fill rate this month"
          value={tasks.fillRate ?? 0}
          suffix="%"
          delta={
            tasks.createdThisMonth === 0
              ? 'No tasks posted this month'
              : `${tasks.filledThisMonth} of ${tasks.createdThisMonth} filled` +
                (tasks.avgTimeToFillHours != null ? ` · ${tasks.avgTimeToFillHours}h to fill` : '')
          }
          delay="d2"
        />
        <KpiCard
          tone="k4"
          icon="naira"
          iconColor="var(--gold)"
          label="Owed to Partimers"
          value={money.owedToPartimers}
          prefix="₦"
          delta={`${formatNairaCompact(money.earnedThisMonth)} earned · ${formatNairaCompact(money.paidOutThisMonth)} paid out this month`}
          delay="d3"
        />
      </div>

      <div className="dash">
        <Glass reveal delay="d1" style={{ padding: 22 }}>
          <div className="card-h">
            <div>
              <h3>Needs your attention</h3>
              <div className="sub">{data.attention.length === 0 ? 'All caught up' : 'Oldest first on each page'}</div>
            </div>
          </div>
          <div className="feed">
            {data.attention.length === 0 ? (
              <div className="frow" style={{ color: 'var(--muted)' }}>
                Nothing waiting: you&apos;re all caught up.
              </div>
            ) : (
              data.attention.map((a) => {
                const meta = ATTENTION_ICON[a.type] ?? { icon: 'alert' as IconName, color: 'var(--gold)' }
                return (
                  <div className="frow" key={a.type}>
                    <span className="fi" style={{ color: meta.color }}>
                      <Icon name={meta.icon} />
                    </span>
                    <div className="ft">
                      <b>{a.title}</b>
                      <span>{a.sub}</span>
                    </div>
                    <Button variant="glass" size="sm" onClick={() => navigate(a.to)}>
                      Open
                    </Button>
                  </div>
                )
              })
            )}
          </div>
        </Glass>

        <Glass reveal delay="d2" style={{ padding: 22 }}>
          <div className="card-h">
            <div>
              <h3>Recent activity</h3>
              <div className="sub">Sign-ups, applications, payments and payouts</div>
            </div>
          </div>
          <div className="feed">
            {data.activity.length === 0 ? (
              <div className="frow" style={{ color: 'var(--muted)' }}>
                No activity yet.
              </div>
            ) : (
              data.activity.map((a, i) => <ActivityRow key={i} item={a} />)
            )}
          </div>
        </Glass>
      </div>

      <div className="dash section-gap">
        <Glass reveal delay="d1" style={{ padding: 22 }}>
          <div className="card-h">
            <div>
              <h3>Spend by category</h3>
              <div className="sub">This month · {formatNaira(money.committedThisMonth)} committed</div>
            </div>
          </div>
          {data.spendByCategory.length === 0 ? (
            <div className="frow" style={{ color: 'var(--muted)' }}>No payments this month yet.</div>
          ) : (
            <Suspense fallback={<Skeleton className="w-full rounded-[var(--r-sm)]" style={{ height: 200 }} />}>
              <CategoryBars data={data.spendByCategory} />
            </Suspense>
          )}
        </Glass>

        <Glass reveal delay="d2" style={{ padding: 22 }}>
          <div className="card-h">
            <div>
              <h3>Fill rate</h3>
              <div className="sub">Tasks posted this month</div>
            </div>
          </div>
          <Suspense fallback={<Skeleton className="w-full rounded-[var(--r-sm)]" style={{ height: 200 }} />}>
            <FillRateMeter
              pct={tasks.fillRate ?? 0}
              filled={tasks.filledThisMonth}
              open={Math.max(0, tasks.createdThisMonth - tasks.filledThisMonth)}
            />
          </Suspense>
        </Glass>
      </div>

      <div className="dash section-gap">
        <Glass reveal delay="d1" style={{ padding: 22 }}>
          <div className="card-h">
            <div>
              <h3>Where Partimers live</h3>
              <div className="sub">Top states</div>
            </div>
          </div>
          <StateList rows={data.partimersByState} unit="" />
        </Glass>
        <Glass reveal delay="d2" style={{ padding: 22 }}>
          <div className="card-h">
            <div>
              <h3>Where the work is</h3>
              <div className="sub">Open tasks by state</div>
            </div>
          </div>
          <StateList rows={data.tasksByState} unit="" />
        </Glass>
      </div>
    </>
  )
}
