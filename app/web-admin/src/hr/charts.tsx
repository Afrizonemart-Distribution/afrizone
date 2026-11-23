/**
 * HR console charts and people pieces (2026-11-24).
 *
 * Ported from 21st.dev and restyled to Afrizonemart (Navy #000066, gold
 * #FBAC34, Raleway):
 *   · KpiCard, Sparkline, ChartCard, BarList, Donut ← "Charts & KPI Cards"
 *     (uvain / Layro System). Kept its rules: a KPI knows whether up is good,
 *     colour follows the series not its rank, thin marks, and every chart
 *     carries a visually hidden data table so nothing depends on colour or
 *     hover. Rebuilt in plain SVG instead of Recharts: no new dependency and
 *     a smaller bundle.
 *   · PersonCell ← "Team Members Table" (cnippet): avatar, name, sub line.
 *   · PresenceBoard ← "User Presence Avatar" (adrielzimbril), used as a
 *     design reference only. Static on purpose: no motion, so no kill switch
 *     is needed and nothing can jank the board.
 */
import { type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import Icon, { type IconName } from '../components/Icon'
import './charts.css'

/** Series colours in a fixed order (never by rank). */
export const SERIES = ['var(--navy)', 'var(--gold)', 'var(--indigo)', 'var(--money)', 'var(--clay, #b4532a)']
const fmt = (v: number) => v.toLocaleString()

const srOnly: CSSProperties = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }

function HiddenTable({ caption, rows, format = fmt }: { caption: string; rows: { label: string; value: number }[]; format?: (v: number) => string }) {
  return (
    <div style={srOnly}>
      <table>
        <caption>{caption}</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td>{format(r.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Sparkline ───────────────────────────────────────────────────────────────

export function Sparkline({ data, color = 'var(--navy)', width = 84, height = 30 }: { data: number[]; color?: string; width?: number; height?: number }) {
  if (data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const step = (width - 4) / (data.length - 1)
  const pts = data.map((v, i) => `${(2 + i * step).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`).join(' ')
  return (
    <svg aria-hidden width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="hrx-spark">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── KPI card ────────────────────────────────────────────────────────────────

export interface KpiCardProps {
  label: string
  value: ReactNode
  icon?: IconName
  /** Icon colour. */
  tone?: string
  hint?: ReactNode
  /** Change vs the previous period as a fraction: 0.124 = +12.4%. */
  delta?: number
  /** Whether up is good (headcount) or bad (absence). Default "up". */
  good?: 'up' | 'down'
  period?: string
  trend?: number[]
  onClick?: () => void
}

export function KpiCard({ label, value, icon, tone = 'var(--navy)', hint, delta, good = 'up', period, trend, onClick }: KpiCardProps) {
  const up = (delta ?? 0) >= 0
  const positive = delta === undefined ? null : (up && good === 'up') || (!up && good === 'down')
  const clickable = !!onClick
  const Tag = clickable ? 'button' : 'div'
  return (
    <Tag type={clickable ? 'button' : undefined} className={`hrx-kpi${clickable ? ' is-link' : ''}`} onClick={onClick}>
      <span className="hrx-kpi-label">
        {icon && (
          <span className="hrx-kpi-icon" style={{ color: tone }}>
            <Icon name={icon} size={15} />
          </span>
        )}
        {label}
      </span>
      <span className="hrx-kpi-row">
        <span className="hrx-kpi-value tnum">{value}</span>
        {trend && <Sparkline data={trend} color={tone} />}
      </span>
      {delta !== undefined && (
        <span className="hrx-kpi-delta">
          <span className={positive ? 'is-good' : 'is-bad'}>
            <span aria-hidden>{up ? '↗' : '↘'}</span>
            <span style={srOnly}>{up ? 'Up' : 'Down'} </span>
            {Math.abs(delta * 100).toFixed(1)}%
          </span>
          {period && <span className="hrx-muted">{period}</span>}
        </span>
      )}
      {hint && <span className="hrx-kpi-hint">{hint}</span>}
    </Tag>
  )
}

// ── Chart card ──────────────────────────────────────────────────────────────

export function ChartCard({ title, subtitle, actions, children, className = '', ...rest }: Omit<HTMLAttributes<HTMLElement>, 'title'> & { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <figure className={`hrx-chart ${className}`} {...rest}>
      <figcaption className="hrx-chart-head">
        <span>
          <span className="hrx-chart-title">{title}</span>
          {subtitle && <span className="hrx-chart-sub">{subtitle}</span>}
        </span>
        {actions}
      </figcaption>
      {children}
    </figure>
  )
}

// ── Bar list (categories, largest first) ────────────────────────────────────

export function BarList({ data, label = (k) => k, description, color = 'var(--navy)', format = fmt }: { data: Record<string, number>; label?: (k: string) => string; description: string; color?: string; format?: (v: number) => string }) {
  const rows = Object.entries(data)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ label: label(k), value: v }))
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="hrx-bars">
      <div role="img" aria-label={description}>
        <div aria-hidden className="hrx-bars-list">
          {rows.map((r) => (
            <div key={r.label} className="hrx-bar-row">
              <span className="hrx-bar-label">{r.label}</span>
              <span className="hrx-bar-track">
                <span className="hrx-bar-fill" style={{ width: `${(r.value / max) * 100}%`, background: color }} />
              </span>
              <span className="hrx-bar-value tnum">{format(r.value)}</span>
            </div>
          ))}
        </div>
      </div>
      <HiddenTable caption={description} rows={rows} format={format} />
    </div>
  )
}

// ── Donut ───────────────────────────────────────────────────────────────────

export function Donut({ data, label = (k) => k, description, centerLabel = 'Total', size = 156, format = fmt }: { data: Record<string, number>; label?: (k: string) => string; description: string; centerLabel?: string; size?: number; format?: (v: number) => string }) {
  // Fixed order (by key) so a slice keeps its colour when others change.
  const rows = Object.entries(data)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v], i) => ({ label: label(k), value: v, color: SERIES[i % SERIES.length] }))
  const total = rows.reduce((n, r) => n + r.value, 0)
  const r = 42
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="hrx-donut">
      <div role="img" aria-label={description} className="hrx-donut-ring" style={{ width: size, height: size }}>
        <svg aria-hidden viewBox="0 0 100 100" width={size} height={size}>
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--track)" strokeWidth="12" />
          {total > 0 &&
            rows.map((s) => {
              const len = (s.value / total) * c
              const el = <circle key={s.label} cx="50" cy="50" r={r} fill="none" stroke={s.color} strokeWidth="12" strokeDasharray={`${Math.max(len - 1.5, 0)} ${c}`} strokeDashoffset={-offset} transform="rotate(-90 50 50)" />
              offset += len
              return el
            })}
        </svg>
        <span className="hrx-donut-center">
          <span className="hrx-muted">{centerLabel}</span>
          <b className="tnum">{format(total)}</b>
        </span>
      </div>
      <ul className="hrx-donut-legend">
        {rows.map((s) => (
          <li key={s.label}>
            <span>
              <i style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="tnum">
              <b>{format(s.value)}</b>
              <span className="hrx-muted"> {total ? Math.round((s.value / total) * 100) : 0}%</span>
            </span>
          </li>
        ))}
      </ul>
      <HiddenTable caption={description} rows={rows} format={format} />
    </div>
  )
}

// ── People ──────────────────────────────────────────────────────────────────

export const initials = (name: string | null | undefined) =>
  (name ?? '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('') || '?'

export type Presence = 'online' | 'away' | 'off' | 'leave'

export function Avatar({ name, size = 34, presence, intern }: { name: string | null | undefined; size?: number; presence?: Presence; intern?: boolean }) {
  return (
    <span className={`hrx-avatar${intern ? ' is-intern' : ''}`} style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden>
      {initials(name)}
      {presence && <i className={`hrx-dot is-${presence}`} />}
    </span>
  )
}

/** Avatar + name + a muted second line; links to the person when given an id. */
export function PersonCell({ userId, name, sub, presence, intern }: { userId?: string; name: string | null; sub?: ReactNode; presence?: Presence; intern?: boolean }) {
  const label = name ?? 'Unnamed'
  return (
    <span className="hrx-person">
      <Avatar name={name} presence={presence} intern={intern} />
      <span className="hrx-person-text">
        {userId ? (
          <Link to={`/hr/people/${userId}`} className="hrx-person-name" onClick={(e) => e.stopPropagation()}>
            {label}
          </Link>
        ) : (
          <span className="hrx-person-name">{label}</span>
        )}
        {sub && <span className="hrx-person-sub">{sub}</span>}
      </span>
    </span>
  )
}

// ── Presence board ──────────────────────────────────────────────────────────

export interface PresencePerson {
  userId: string
  name: string | null
  presence: Presence
  detail?: string
  intern?: boolean
}

function Cluster({ title, people, empty }: { title: string; people: PresencePerson[]; empty: string }) {
  return (
    <section className="hrx-cluster" aria-label={`${title}: ${people.length}`}>
      <header>
        <span>{title}</span>
        <b className="tnum">{people.length}</b>
      </header>
      {people.length === 0 ? (
        <span className="hrx-muted">{empty}</span>
      ) : (
        <ul>
          {people.map((p) => (
            <li key={p.userId}>
              <Link to={`/hr/people/${p.userId}`} className="hrx-chip" title={p.detail ? `${p.name ?? 'Unnamed'} · ${p.detail}` : (p.name ?? 'Unnamed')}>
                <Avatar name={p.name} size={28} presence={p.presence} intern={p.intern} />
                <span>{(p.name ?? 'Unnamed').split(' ')[0]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Who is in and who isn't, at a glance. The full table sits below it. */
export function PresenceBoard({ people }: { people: PresencePerson[] }) {
  const working = people.filter((p) => p.presence === 'online')
  const notNow = people.filter((p) => p.presence !== 'online')
  return (
    <div className="hrx-presence">
      <Cluster title="Working now" people={working} empty="Nobody is signed in to an admin right now." />
      <Cluster title="Away, not in or on leave" people={notNow} empty="Everyone is working." />
    </div>
  )
}
