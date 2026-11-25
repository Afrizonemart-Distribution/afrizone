import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import './AppShell.css'
import { useConsolePresence } from '../lib/presence'

export default function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  useConsolePresence()

  return (
    <div className="app">
      {menuOpen && (
        <div className="side-scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />
      )}
      <Sidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />
      <div className="main">
        <Topbar onMenu={() => setMenuOpen((v) => !v)} />
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
