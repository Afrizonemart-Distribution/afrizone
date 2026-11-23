/**
 * The AZM Staff side of the console: routes, the Part-Time fence for AZM_HR,
 * and the online signal this admin sends like every other product admin.
 */
import { lazy, Suspense, useEffect, useRef, type ComponentType, type ReactNode } from 'react'
import { Navigate, Route, useLocation } from 'react-router-dom'
import { request } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { EmptyState, LoadingState } from '../components/ui/StateView'
import Glass from '../components/ui/Glass'
import { useHr } from './HrContext'
// Lazy: only HR staff open these, so the Part-Time console stays as light as before.
const named = <T extends Record<string, ComponentType>>(load: () => Promise<T>, name: keyof T) => lazy(() => load().then((m) => ({ default: m[name] })))
const visibility = () => import('./pages/Visibility')
const money = () => import('./pages/Money')
const workplace = () => import('./pages/Workplace')
const growth = () => import('./pages/Growth')
const admin = () => import('./pages/Admin')
const HrAccess = named(visibility, 'HrAccess')
const HrAlerts = named(visibility, 'HrAlerts')
const HrAttendance = named(visibility, 'HrAttendance')
const HrOutput = named(visibility, 'HrOutput')
const HrClaims = named(money, 'HrClaims')
const HrPayroll = named(money, 'HrPayroll')
const HrPayrollRun = named(money, 'HrPayrollRun')
const HrAssets = named(workplace, 'HrAssets')
const HrPolicies = named(workplace, 'HrPolicies')
const HrQueries = named(workplace, 'HrQueries')
const HrReviews = named(workplace, 'HrReviews')
const HrHiring = named(growth, 'HrHiring')
const HrSurveys = named(growth, 'HrSurveys')
const HrTraining = named(growth, 'HrTraining')
const HrReports = named(admin, 'HrReports')
const HrSettings = named(admin, 'HrSettings')
const HrLeave = lazy(() => import('./pages/Leave'))
const HrLive = lazy(() => import('./pages/Live'))
const HrOverview = lazy(() => import('./pages/Overview'))
const HrPeople = lazy(() => import('./pages/People'))
const HrPerson = lazy(() => import('./pages/Person'))

/** AZM_HR accounts only ever see the AZM Staff side. */
export function PartTimeOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (user?.role === 'AZM_HR') return <Navigate to="/hr" replace />
  return <>{children}</>
}

/** The AZM Staff side needs hr.* from Afrizonemart. */
function HrOnly({ children }: { children: ReactNode }) {
  const { me, loading, reason } = useHr()
  if (loading) return <LoadingState label="Checking your HR access…" />
  if (!me)
    return (
      <Glass>
        <EmptyState icon="lock" title="No AZM HR access" sub={reason ?? 'Ask an Owner to grant you an HR permission in Staff access (Part-Time console membership).'} />
      </Glass>
    )
  return <>{children}</>
}

const wrap = (el: ReactNode) => (
  <HrOnly>
    <Suspense fallback={<LoadingState label="Loading…" />}>{el}</Suspense>
  </HrOnly>
)

export const hrRoutes = (
  <>
    <Route path="/hr" element={wrap(<HrOverview />)} />
    <Route path="/hr/live" element={wrap(<HrLive />)} />
    <Route path="/hr/alerts" element={wrap(<HrAlerts />)} />
    <Route path="/hr/people" element={wrap(<HrPeople />)} />
    <Route path="/hr/people/:id" element={wrap(<HrPerson />)} />
    <Route path="/hr/attendance" element={wrap(<HrAttendance />)} />
    <Route path="/hr/output" element={wrap(<HrOutput />)} />
    <Route path="/hr/access" element={wrap(<HrAccess />)} />
    <Route path="/hr/leave" element={wrap(<HrLeave />)} />
    <Route path="/hr/assets" element={wrap(<HrAssets />)} />
    <Route path="/hr/reviews" element={wrap(<HrReviews />)} />
    <Route path="/hr/queries" element={wrap(<HrQueries />)} />
    <Route path="/hr/policies" element={wrap(<HrPolicies />)} />
    <Route path="/hr/payroll" element={wrap(<HrPayroll />)} />
    <Route path="/hr/payroll/:id" element={wrap(<HrPayrollRun />)} />
    <Route path="/hr/claims" element={wrap(<HrClaims />)} />
    <Route path="/hr/hiring" element={wrap(<HrHiring />)} />
    <Route path="/hr/training" element={wrap(<HrTraining />)} />
    <Route path="/hr/surveys" element={wrap(<HrSurveys />)} />
    <Route path="/hr/reports" element={wrap(<HrReports />)} />
    <Route path="/hr/settings" element={wrap(<HrSettings />)} />
  </>
)

/**
 * Workforce presence: every 60 s while the console is open, like the supplier
 * portal's StaffPresence. Idle after 5 minutes without input; hidden tabs
 * count as idle. Best effort: an unlinked account or a network blip is ignored.
 */
export function useConsolePresence() {
  const { user } = useAuth()
  const location = useLocation()
  const session = useRef<string | undefined>(undefined)
  const lastInput = useRef(Date.now())
  const path = useRef(location.pathname)
  path.current = location.pathname

  useEffect(() => {
    if (!user) return
    const bump = () => (lastInput.current = Date.now())
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    let stopped = false
    const beat = async () => {
      if (stopped) return
      const idle = document.hidden || Date.now() - lastInput.current > 5 * 60_000
      try {
        const res = await request<{ sessionId?: string; off?: boolean }>('/admin/presence', { method: 'POST', body: { sessionId: session.current, idle, path: path.current } })
        if (res.sessionId) session.current = res.sessionId
      } catch {
        // A 404 means the session was closed (idle sweep): start a new one next beat.
        session.current = undefined
      }
    }
    void beat()
    const t = setInterval(beat, 60_000)
    return () => {
      stopped = true
      clearInterval(t)
      events.forEach((e) => window.removeEventListener(e, bump))
    }
  }, [user?.id])
}
