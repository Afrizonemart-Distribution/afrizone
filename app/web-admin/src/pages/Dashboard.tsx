import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../lib/useApi'
import { formatNaira, formatNairaCompact } from '../lib/format'
import Glass from '../components/ui/Glass'
import Button from '../components/ui/Button'
import KpiCard from '../components/ui/KpiCard'
import Icon, { type IconName } from '../components/Icon'
import { ErrorState, LoadingState } from '../components/ui/StateView'
import type { DashboardActivity, DashboardUrgent } from '../api/types'
import './Dashboard.css'

const TONE_COLOR: Record<string, string> = {
  clay: 'var(--clay)',
  gold: 'var(--gold)',
  money: 'var(--money)',
  indigo: 'var(--indigo)',
  amber: 'var(--amber)',
}

const URGENT_ICON: Record<string, { icon: IconName; color: string }> = {
  payments: { icon: 'card', color: 'var(--money)' },
  timesheets: { icon: 'clock', color: 'var(--amber)' },
  kyc: { icon: 'users', color: 'var(--indigo)' },
  dispute: { icon: 'alert', color: 'var(--danger)' },
}

const ACTIVITY_ICON: Record<string, { icon: IconName; color: string }> = {
  check: { icon: 'check', color: 'var(--money)' },
  apply: { icon: 'arrow-up', color: 'var(--clay)' },
  contract: { icon: 'tasks', color: 'var(--gold)' },
  publish: { icon: 'send', color: 'var(--indigo)' },
  payment: { icon: 'card', color: 'var(--money)' },
}

function Bars({ data }: { data: { label: string; value: number; tone?: string }[] }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])
  const max = Math.max(...data.map((d) => d.value), 1)
  return (
    <div className="bars">
      {data.map((d, i) => (
        <div className="bar-col" key={d.label + i}>
          <div className="bar-track">
            <i
              className="bar"
              style={{
                height: mounted ? `${(d.value / max) * 100}%` : 0,
                transitionDelay: `${i * 70}ms`,
                background: d.tone ? TONE_COLOR[d.tone] ?? 'var(--grad)' : 'var(--grad)',
              }}
            />
          </div>
          <span className="bar-lbl">{d.label}</span>
        </div>
      ))}
    </div>
  )
}

function Donut({ pct, filled, open }: { pct: number; filled: number; open: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.setProperty('--p', '0')
    const id = requestAnimationFrame(() => el.style.setProperty('--p', String(pct)))
    return () => cancelAnimationFrame(id)
  }, [pct])
  return (
    <div className="donut-wrap">
      <div className="donut" ref={ref}>
        <div className="mid">
          <b className="tnum">{pct}%</b>
          <span>filled</span>
        </div>
      </div>
      <div className="legend">
        <div className="li">
          <span className="sw" style={{ background: 'var(--clay-deep)' }} />
          Filled · {filled}
        </div>
        <div className="li">
          <span className="sw" style={{ background: 'rgba(36,28,21,.12)' }} />
          Open · {open}
        </div>
      </div>
    </div>
  )
}

function UrgentRow({ item, onGo }: { item: DashboardUrgent; onGo: (t: string) => void }) {
  const meta = URGENT_ICON[item.type] ?? { icon: 'alert' as IconName, color: 'var(--gold)' }
  return (
    <div className="frow">
      <span className="fi" style={{ color: meta.color }}>
        <Icon name={meta.icon} />
      </span>
      <div className="ft">
        <b>{item.title}</b>
        <span>{item.sub}</span>
      </div>
      {item.type === 'payments' ? (
        <Button variant="money" size="sm" onClick={() => onGo('/payments')}>
          Release
        </Button>
      ) : item.type === 'kyc' ? (
        <Button variant="glass" size="sm" onClick={() => onGo('/workers')}>
          Review
        </Button>
      ) : item.type === 'timesheets' ? (
        <Button variant="glass" size="sm" onClick={() => onGo('/timesheets')}>
          Review
        </Button>
      ) : (
        <Button variant="glass" size="sm" onClick={() => onGo('/disputes')}>
          Review
        </Button>
      )}
    </div>
  )
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

export default function Dashboard() {
  const navigate = useNavigate()
  const { data, loading, error, reload } = useApi((signal) => api.dashboardStats(signal))

  if (loading) return <LoadingState label="Loading dashboard…" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return null

  const spendM = data.spendThisMonth / 1_000_000

  return (
    <>
      <div className="phead rv in">
        <div>
          <span className="chip">
            <span className="pulse" />
            Live · Lagos &amp; FCT
          </span>
          <h1 style={{ marginTop: 12 }}>Operations dashboard</h1>
          <div className="crumb">
            {data.urgent.reduce((n, u) => n + (u.type === 'payments' ? u.count : 0), 0)} payments
            awaiting your release
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button variant="glass" size="sm" icon="arrow-up">
            Export
          </Button>
          <Button variant="primary" size="sm" icon="arrow-right" onClick={() => navigate('/payments')}>
            Release queue
          </Button>
        </div>
      </div>

      <div className="kpis">
        <KpiCard
          tone="k1"
          icon="grid"
          iconColor="var(--clay)"
          label="Active tasks"
          value={data.activeTasks}
          delta="Live across regions"
        />
        <KpiCard
          tone="k2"
          icon="check-circle"
          iconColor="var(--money)"
          label="Fill rate"
          value={data.fillRate}
          suffix="%"
          delta="Healthy"
          delay="d1"
        />
        <KpiCard
          tone="k3"
          icon="clock"
          iconColor="var(--gold)"
          label="Avg. time to fill"
          value={data.avgTimeToFillHours}
          suffix="h"
          delta="SLA target 8h"
          deltaTone="warn"
          delay="d2"
        />
        <KpiCard
          tone="k4"
          icon="naira"
          iconColor="var(--indigo)"
          label="Spend this month"
          value={spendM}
          decimals={2}
          prefix="₦"
          suffix="M"
          delta={`on ${formatNairaCompact(data.budgetThisMonth)} budget`}
          delay="d3"
        />
      </div>

      <div className="dash">
        <Glass reveal delay="d1" style={{ padding: 22 }}>
          <div className="card-h">
            <div>
              <h3>Spend by category</h3>
              <div className="sub">This month · {formatNaira(data.spendThisMonth)} total</div>
            </div>
            <span className="chip">Monthly</span>
          </div>
          <Bars data={data.spendByCategory} />
        </Glass>

        <Glass reveal delay="d2" style={{ padding: 22 }}>
          <div className="card-h">
            <div>
              <h3>Fill rate</h3>
              <div className="sub">This month</div>
            </div>
          </div>
          <Donut pct={data.fillRate} filled={data.fill.filled} open={data.fill.open} />
        </Glass>
      </div>

      <div className="dash section-gap">
        <Glass reveal delay="d2" style={{ padding: 22 }}>
          <div className="card-h">
            <div>
              <h3>Needs your attention</h3>
              <div className="sub">{data.urgent.length} items flagged</div>
            </div>
          </div>
          <div className="feed">
            {data.urgent.length === 0 ? (
              <div className="frow" style={{ color: 'var(--muted)' }}>
                Nothing urgent — you&apos;re all caught up.
              </div>
            ) : (
              data.urgent.map((u, i) => <UrgentRow key={i} item={u} onGo={navigate} />)
            )}
          </div>
        </Glass>

        <Glass reveal delay="d3" style={{ padding: 22 }}>
          <div className="card-h">
            <div>
              <h3>Recent activity</h3>
              <div className="sub">Live feed</div>
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
    </>
  )
}
