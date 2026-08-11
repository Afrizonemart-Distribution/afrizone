import { NavLink } from 'react-router-dom'
import Icon, { type IconName } from './Icon'
import Logo from './Logo'
import { useAuth } from '../auth/AuthContext'
import { initials } from '../lib/format'
import './Sidebar.css'

interface NavItem {
  to: string
  label: string
  icon: IconName
  badge?: number
}

const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Operations',
    items: [
      { to: '/', label: 'Dashboard', icon: 'grid' },
      { to: '/tasks', label: 'Tasks', icon: 'tasks' },
      { to: '/applications', label: 'Applications', icon: 'file' },
      { to: '/timesheets', label: 'Timesheets', icon: 'clock' },
      { to: '/payments', label: 'Payments', icon: 'card' },
      { to: '/disputes', label: 'Disputes', icon: 'alert' },
    ],
  },
  {
    label: 'People',
    items: [
      { to: '/workers', label: 'Workers', icon: 'users' },
      { to: '/hiring', label: 'Hiring', icon: 'briefcase' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { to: '/reports', label: 'Reports', icon: 'chart' },
      { to: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
]

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  TASK_MANAGER: 'Task Manager',
  HR_ADMIN: 'HR Admin',
  WORKER: 'Worker',
}

export default function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { user } = useAuth()

  return (
    <aside className={`side ${open ? 'open' : ''}`}>
      <div className="brand">
        <Logo size={38} tone="light" tagline />
      </div>

      <nav aria-label="Primary">
        {GROUPS.map((g) => (
          <div key={g.label}>
            <div className="navlabel">{g.label}</div>
            {g.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
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
        <span className="avatar">{user ? initials(user.name) : 'AZ'}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{user?.name ?? 'Admin'}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            {user ? ROLE_LABEL[user.role] ?? user.role : '—'}
            {user?.location ? ` · ${user.location}` : ''}
          </div>
        </div>
      </div>
    </aside>
  )
}
