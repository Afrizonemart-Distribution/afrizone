import { Navigate, Route, Routes } from 'react-router-dom'
import { TiersProvider } from './lib/tiers'
import { ProtectedRoute } from './auth/AuthContext'
import AppShell from './components/AppShell'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Dashboard from './pages/Dashboard'
import Tasks from './pages/Tasks'
import Payments from './pages/Payments'
import Workers from './pages/Workers'
import Applications from './pages/Applications'
import Timesheets from './pages/Timesheets'
import Hiring from './pages/Hiring'
import TalentPools from './pages/TalentPools'
import Reports from './pages/Reports'
import Settings from './pages/Settings'
import Disputes from './pages/Disputes'
import Verification from './pages/Verification'
import Mart from './pages/Mart'
import IdentityChecks from './pages/IdentityChecks'
import WithdrawalChecks from './pages/WithdrawalChecks'
import StaffAccess from './pages/StaffAccess'
import { HrProvider } from './hr/HrContext'
import { hrRoutes, PartTimeOnly } from './hr/routes'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        element={
          <ProtectedRoute>
            <TiersProvider>
              <HrProvider>
                <AppShell />
              </HrProvider>
            </TiersProvider>
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<PartTimeOnly><Dashboard /></PartTimeOnly>} />
        <Route path="/tasks" element={<PartTimeOnly><Tasks /></PartTimeOnly>} />
        <Route path="/applications" element={<PartTimeOnly><Applications /></PartTimeOnly>} />
        <Route path="/timesheets" element={<PartTimeOnly><Timesheets /></PartTimeOnly>} />
        <Route path="/payments" element={<PartTimeOnly><Payments /></PartTimeOnly>} />
        <Route path="/disputes" element={<PartTimeOnly><Disputes /></PartTimeOnly>} />
        <Route path="/verification" element={<PartTimeOnly><Verification /></PartTimeOnly>} />
        <Route path="/identity" element={<PartTimeOnly><IdentityChecks /></PartTimeOnly>} />
        <Route path="/withdrawals" element={<PartTimeOnly><WithdrawalChecks /></PartTimeOnly>} />
        <Route path="/workers" element={<PartTimeOnly><Workers /></PartTimeOnly>} />
        <Route path="/mart" element={<PartTimeOnly><Mart /></PartTimeOnly>} />
        <Route path="/hiring" element={<PartTimeOnly><Hiring /></PartTimeOnly>} />
        <Route path="/talent-pools" element={<PartTimeOnly><TalentPools /></PartTimeOnly>} />
        <Route path="/staff-access" element={<PartTimeOnly><StaffAccess /></PartTimeOnly>} />
        <Route path="/reports" element={<PartTimeOnly><Reports /></PartTimeOnly>} />
        <Route path="/settings" element={<PartTimeOnly><Settings /></PartTimeOnly>} />
        {hrRoutes}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
