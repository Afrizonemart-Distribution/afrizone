import { Navigate, Route, Routes } from 'react-router-dom'
import Landing from './pages/Landing'
import { Register, SignIn } from './pages/Auth'
import { CourierDashboard, IndividualLanding, StoreDashboard } from './pages/Dashboards'
import { homeFor, useAuth } from './lib/auth'

/**
 * Routes for the PartTime portal.
 *
 * `/` is the three-way front door and stays reachable while signed out. Someone
 * already signed in is sent to whichever dashboard their SERVER-side account
 * type says is theirs, rather than being asked the question again.
 */
export default function App() {
  const { user, loading } = useAuth()

  return (
    <Routes>
      <Route
        path="/"
        element={!loading && user ? <Navigate to={homeFor(user.accountType)} replace /> : <Landing />}
      />
      <Route path="/signin" element={<SignIn />} />
      <Route path="/register/:type" element={<Register />} />
      <Route path="/store" element={<StoreDashboard />} />
      <Route path="/courier" element={<CourierDashboard />} />
      <Route path="/individual" element={<IndividualLanding />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
