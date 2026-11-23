/**
 * Small building blocks the HR pages share, on top of the console's own
 * components (Glass, Button, StatusPill, Modal, StateView), so the AZM Staff
 * side looks and behaves like the rest of the admin.
 */
import { useCallback, useState, type CSSProperties, type ReactNode } from 'react'
import { ApiError } from '../api/client'
import Glass from '../components/ui/Glass'
import StatusPill from '../components/ui/StatusPill'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateView'
import type { IconName } from '../components/Icon'
import Icon from '../components/Icon'
import type { PillVariant } from '../lib/format'
import { Label } from '@/components/shadcn/label'

// ── Async results ───────────────────────────────────────────────────────────

export function Load<T>({ r, children, empty, label }: { r: { data: T | null; loading: boolean; error: string | null; reload: () => void }; children: (d: T) => ReactNode; empty?: (d: T) => boolean; label?: string }) {
  if (r.loading && !r.data) return <LoadingState label={label ?? 'Loading…'} />
  if (r.error) return <ErrorState message={r.error} onRetry={r.reload} />
  if (!r.data) return null
  if (empty?.(r.data)) return <Glass><EmptyState title="Nothing here yet" /></Glass>
  return <>{children(r.data)}</>
}

/** Run a write, keep its busy/error state, reload after. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(async (key: string, fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(key)
    setError(null)
    try {
      await fn()
      after?.()
      return true
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong')
      return false
    } finally {
      setBusy(null)
    }
  }, [])
  return { busy, error, setError, run }
}

export function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <div className="login-error" role="alert" style={{ margin: '0 0 14px' }}>
      {error}
    </div>
  )
}

// ── Layout ──────────────────────────────────────────────────────────────────

export function Section({ title, sub, actions, children, style, pad = true }: { title?: string; sub?: ReactNode; actions?: ReactNode; children: ReactNode; style?: CSSProperties; pad?: boolean }) {
  return (
    <Glass style={{ padding: pad ? 20 : 0, marginBottom: 16, ...style }}>
      {(title || actions) && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14, padding: pad ? 0 : '18px 20px 0', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {title && <h3 style={{ fontSize: 16, margin: 0 }}>{title}</h3>}
            {sub && <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
          </div>
          {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
        </div>
      )}
      {children}
    </Glass>
  )
}

export function Grid({ min = 220, gap = 12, children }: { min?: number; gap?: number; children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}px, 100%), 1fr))`, gap }}>{children}</div>
}

export function Stat({ label, value, icon, tone = 'var(--navy)', hint, onClick }: { label: string; value: ReactNode; icon?: IconName; tone?: string; hint?: ReactNode; onClick?: () => void }) {
  return (
    <Glass style={{ padding: 16, cursor: onClick ? 'pointer' : undefined }}>
      <div onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={(e) => onClick && e.key === 'Enter' && onClick()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 12.5, fontWeight: 600 }}>
          {icon && (
            <span style={{ color: tone, display: 'inline-flex' }}>
              <Icon name={icon} size={16} />
            </span>
          )}
          {label}
        </div>
        <div className="tnum" style={{ fontSize: 26, fontWeight: 800, marginTop: 6, color: 'var(--text)' }}>
          {value}
        </div>
        {hint && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{hint}</div>}
      </div>
    </Glass>
  )
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number }[] }) {
  return (
    <div role="tablist" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className="chip"
          style={{
            cursor: 'pointer',
            background: value === t.value ? 'var(--navy)' : undefined,
            color: value === t.value ? '#fff' : undefined,
            borderColor: value === t.value ? 'var(--navy)' : undefined,
          }}
        >
          {t.label}
          {t.count ? <span className="tnum" style={{ opacity: 0.8 }}>· {t.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

export interface Col<R> {
  label: string
  render: (r: R) => ReactNode
  width?: number | string
  align?: 'left' | 'right'
}

export function Table<R>({ rows, cols, rowKey, onRow, empty = 'Nothing here yet', emptyIcon = 'inbox' }: { rows: R[]; cols: Col<R>[]; rowKey: (r: R) => string; onRow?: (r: R) => void; empty?: string; emptyIcon?: IconName }) {
  if (rows.length === 0) return <EmptyState icon={emptyIcon} title={empty} />
  return (
    <div className="tablewrap">
      <table className="dt">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.label} style={{ width: c.width, textAlign: c.align ?? 'left' }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} onClick={onRow ? () => onRow(r) : undefined} style={{ cursor: onRow ? 'pointer' : undefined }}>
              {cols.map((c) => (
                <td key={c.label} style={{ textAlign: c.align ?? 'left' }}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Status words ────────────────────────────────────────────────────────────

const STATUS: Record<string, [PillVariant, string]> = {
  ONLINE: ['ready', 'Working now'],
  AWAY: ['active', 'Was in today'],
  ON_LEAVE: ['review', 'On leave'],
  NOT_IN: ['danger', 'Not in'],
  OFF_DAY: ['paid', 'Day off'],
  PRESENT: ['ready', 'Present'],
  LATE: ['active', 'Late'],
  ABSENT: ['danger', 'Absent'],
  LEAVE: ['review', 'Leave'],
  HOLIDAY: ['paid', 'Holiday'],
  ACTIVE: ['ready', 'Active'],
  EXITED: ['paid', 'Left'],
  PENDING_MANAGER: ['pending', 'With manager'],
  PENDING_HR: ['pending', 'With HR'],
  APPROVED: ['ready', 'Approved'],
  REJECTED: ['danger', 'Rejected'],
  CANCELLED: ['paid', 'Cancelled'],
  PAID: ['paid', 'Paid'],
  DRAFT: ['pending', 'Draft'],
  SUBMITTED: ['review', 'Waiting for approval'],
  OPEN: ['active', 'Open'],
  CLOSED: ['paid', 'Closed'],
  PAUSED: ['pending', 'Paused'],
  SELF: ['pending', 'Self review'],
  MANAGER: ['review', 'With reviewer'],
  DONE: ['ready', 'Done'],
  ASSIGNED: ['pending', 'To do'],
}

export function Status({ s, label }: { s: string; label?: string }) {
  const [variant, word] = STATUS[s] ?? ['pending', s.replace(/_/g, ' ').toLowerCase()]
  return <StatusPill variant={variant} label={label ?? word} />
}

export function Tag({ children, tone }: { children: ReactNode; tone?: 'intern' | 'warn' | 'bad' | 'ok' }) {
  const colors: Record<string, [string, string]> = {
    intern: ['rgba(45,91,168,.1)', 'var(--indigo)'],
    warn: ['rgba(251,172,52,.16)', 'var(--gold-ink)'],
    bad: ['rgba(192,57,43,.1)', 'var(--danger-ink)'],
    ok: ['rgba(47,161,82,.12)', 'var(--money-ink)'],
  }
  const [bg, fg] = tone ? colors[tone] : ['var(--glass-2)', 'var(--muted)']
  return <span style={{ display: 'inline-block', fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: bg, color: fg, whiteSpace: 'nowrap' }}>{children}</span>
}

export function TypeTag({ t }: { t: string }) {
  if (t === 'INTERN') return <Tag tone="intern">Intern</Tag>
  if (t === 'CONTRACT') return <Tag>Contract</Tag>
  return <Tag>Full-time</Tag>
}

// ── Forms ───────────────────────────────────────────────────────────────────

export function Field({ label, htmlFor, help, children, span }: { label: string; htmlFor?: string; help?: ReactNode; children: ReactNode; span?: boolean }) {
  return (
    <div className="field" style={{ marginBottom: 12, gridColumn: span ? '1 / -1' : undefined }}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {help && <div className="help">{help}</div>}
    </div>
  )
}

export function FormGrid({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))', columnGap: 14 }}>{children}</div>
}

export function Muted({ children }: { children: ReactNode }) {
  return <span style={{ color: 'var(--muted)', fontSize: 13 }}>{children}</span>
}

export function NoAccess({ need }: { need: string }) {
  return (
    <Glass>
      <EmptyState icon="lock" title="Not for your role" sub={`This needs ${need}. Ask an Owner to grant it in Staff access.`} />
    </Glass>
  )
}
