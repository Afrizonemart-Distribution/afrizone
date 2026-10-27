import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './auth/AuthContext'
import AppShell from './components/AppShell'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Dashboard from './pages/Dashboard'
import Tasks from './pages/Tasks'
import Payments from './pages/Payments'
import Workers from './pages/Workers'
import Organizations from './pages/Organizations'
import Applications from './pages/Applications'
import Timesheets from './pages/Timesheets'
import Hiring from './pages/Hiring'
import Reports from './pages/Reports'
import Settings from './pages/Settings'
import Disputes from './pages/Disputes'
import Audits from './pages/Audits'
import Verification from './pages/Verification'
import Mart from './pages/Mart'
import Deliveries from './pages/Deliveries'
import Network from './pages/Network'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/applications" element={<Applications />} />
        <Route path="/timesheets" element={<Timesheets />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/disputes" element={<Disputes />} />
        <Route path="/audits" element={<Audits />} />
        <Route path="/verification" element={<Verification />} />
        <Route path="/workers" element={<Workers />} />
        <Route path="/organizations" element={<Organizations />} />
        <Route path="/network" element={<Network />} />
        <Route path="/mart" element={<Mart />} />
        <Route path="/deliveries" element={<Deliveries />} />
        <Route path="/hiring" element={<Hiring />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
