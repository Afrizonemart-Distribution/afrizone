import { NavLink, useNavigate } from 'react-router-dom'
import Icon, { type IconName } from './Icon'
import Logo from './Logo'
import { useAuth } from '../auth/AuthContext'
import { initials } from '../lib/format'
import './Sidebar.css'
import { Avatar, AvatarFallback } from '@/components/shadcn/avatar'
import { useHr } from '../hr/HrContext'
import type { HrCap } from '../hr/api'

interface NavItem {
  to: string
  label: string
  icon: IconName
  badge?: number
  /** Only these Part-Time roles see the item. */
  roles?: string[]
  /** AZM Staff side: only people holding this HR capability see it. */
  cap?: HrCap
}

/**
 * The AZM Staff side (AZM HR Console). Separate from everything above: its
 * data lives in Afrizonemart and it never shows Partimer data.
 */
const HR_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'See',
    items: [
      { to: '/hr', label: 'Overview', icon: 'grid' },
      { to: '/hr/live', label: "Who's working", icon: 'eye' },
      { to: '/hr/attendance', label: 'Attendance', icon: 'clock' },
      { to: '/hr/output', label: 'Output', icon: 'tasks' },
      { to: '/hr/access', label: 'Access review', icon: 'shield' },
      { to: '/hr/alerts', label: 'Alerts', icon: 'bell' },
    ],
  },
  {
    label: 'People',
    items: [
      { to: '/hr/people', label: 'People', icon: 'users' },
      { to: '/hr/leave', label: 'Leave', icon: 'calendar' },
      { to: '/hr/assets', label: 'Assets', icon: 'key' },
      { to: '/hr/reviews', label: 'Reviews', icon: 'star' },
      { to: '/hr/queries', label: 'Queries', icon: 'alert' },
      { to: '/hr/policies', label: 'Policies & news', icon: 'file' },
    ],
  },
  {
    label: 'Money',
    items: [
      { to: '/hr/payroll', label: 'Payroll', icon: 'naira', cap: 'hr.payroll' },
      { to: '/hr/claims', label: 'Expense claims', icon: 'card' },
    ],
  },
  {
    label: 'Grow',
    items: [
      { to: '/hr/hiring', label: 'Hiring', icon: 'briefcase' },
      { to: '/hr/training', label: 'Training', icon: 'check-circle' },
      { to: '/hr/surveys', label: 'Pulse surveys', icon: 'send' },
      { to: '/hr/reports', label: 'Reports', icon: 'chart' },
      { to: '/hr/settings', label: 'HR settings', icon: 'settings' },
    ],
  },
]

const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Operations',
    items: [
      { to: '/', label: 'Dashboard', icon: 'grid' },
      { to: '/tasks', label: 'Tasks', icon: 'tasks' },
      { to: '/applications', label: 'Applications', icon: 'file' },
      { to: '/timesheets', label: 'Timesheets', icon: 'clock' },
      { to: '/payments', label: 'Payments', icon: 'card' },
      { to: '/withdrawals', label: 'Withdrawals', icon: 'lock' },
      { to: '/disputes', label: 'Disputes', icon: 'alert' },
      { to: '/mart', label: 'Mart', icon: 'inbox' },
    ],
  },
  {
    label: 'People',
    items: [
      { to: '/workers', label: 'Partimers', icon: 'users' },
      { to: '/verification', label: 'Verification', icon: 'shield' },
      { to: '/identity', label: 'Identity checks', icon: 'lock' },
      { to: '/hiring', label: 'Hiring', icon: 'briefcase' },
      { to: '/talent-pools', label: 'Talent pools', icon: 'star' },
      // Afrizonemart-wide staff access. Who may change what (Owners: all
      // products; Product Admins: their own) is decided by Afrizonemart, so
      // the link shows for every console admin role.
      { to: '/staff-access', label: 'Staff access', icon: 'key', roles: ['SUPER_ADMIN', 'HR_ADMIN', 'TASK_MANAGER'] },
    ],
  },
  {
    label: 'Insights',
    items: [
      { to: '/reports', label: 'Reports', icon: 'chart' },
      { to: '/settings?tab=categories', label: 'Categories & tiers', icon: 'tag' },
      { to: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
]

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  TASK_MANAGER: 'Task Manager',
  HR_ADMIN: 'HR Admin',
  WORKER: 'Partimer',
  AZM_HR: 'AZM HR',
}

export default function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { user } = useAuth()
  const hr = useHr()
  const nav = useNavigate()
  const onHr = hr.side === 'hr'
  const groups = onHr ? HR_GROUPS : GROUPS

  return (
    <aside className={`side ${open ? 'open' : ''}`}>
      <div className="brand">
        <Logo size={38} tone="dark" tagline overlap />
      </div>

      {hr.partTime && hr.me && (
        <div role="tablist" aria-label="Console side" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, margin: '0 14px 10px', padding: 4, borderRadius: 12, background: 'var(--rail-hover)' }}>
          {(
            [
              ['parttime', 'Part Time', '/'],
              ['hr', 'AZM Staff', '/hr'],
            ] as const
          ).map(([key, label, to]) => (
            <button
              key={key}
              role="tab"
              aria-selected={hr.side === key}
              onClick={() => {
                nav(to)
                onNavigate()
              }}
              style={{
                padding: '7px 6px',
                borderRadius: 9,
                border: 0,
                cursor: 'pointer',
                fontSize: 12.5,
                fontWeight: 700,
                color: hr.side === key ? 'var(--navy)' : 'var(--rail-muted)',
                background: hr.side === key ? 'var(--gold)' : 'transparent',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {onHr && <div className="navlabel" style={{ color: 'var(--gold)' }}>AZM HR Console</div>}

      <nav aria-label="Primary">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="navlabel">{g.label}</div>
            {g.items.filter((item) => (!item.roles || (user && item.roles.includes(user.role))) && (!item.cap || hr.can(item.cap))).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/' || item.to === '/hr'}
                className={({ isActive }) => `nav ${isActive ? 'on' : ''}`}
                onClick={onNavigate}
              >
                <Icon name={item.icon} />
                {item.label}
                {item.badge ? <span className="badge">{item.badge}</span> : null}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="userbox">
        <Avatar className="avatar">
          <AvatarFallback>{user ? initials(user.name) : 'AZ'}</AvatarFallback>
        </Avatar>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{user?.name ?? 'Admin'}</div>
          <div style={{ fontSize: 11, color: 'var(--rail-muted)' }}>
            {user ? ROLE_LABEL[user.role] ?? user.role : '—'}
            {user?.location ? ` · ${user.location}` : ''}
          </div>
        </div>
      </div>
    </aside>
  )
}
