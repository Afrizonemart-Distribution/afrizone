/**
 * The online signal this console sends, like every other staff admin: a
 * heartbeat each minute while someone is signed in, marked idle after five
 * minutes without input or when the tab is hidden.
 */
import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { request } from '../api/client'
import { useAuth } from '../auth/AuthContext'

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
