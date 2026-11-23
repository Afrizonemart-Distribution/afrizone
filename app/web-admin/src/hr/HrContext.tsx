/**
 * Which side of the console is open (Part Time | AZM Staff) and what the
 * signed-in person may do in HR. HR access is decided by Afrizonemart
 * (hr.* capabilities), so we ask it once per session: a 403 simply means no
 * AZM Staff side for this person.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { hr, type HrCap } from './api'

interface HrMe {
  id: string
  name: string | null
  email: string | null
  owner: boolean
  caps: HrCap[]
}

interface HrState {
  me: HrMe | null
  loading: boolean
  /** Why there's no HR side, when there isn't one (e.g. account not linked). */
  reason: string | null
  can: (cap: HrCap) => boolean
  /** Part Time admins see both sides; AZM_HR sees only AZM Staff. */
  partTime: boolean
  side: 'parttime' | 'hr'
}

const Ctx = createContext<HrState | null>(null)

export function HrProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()
  const [me, setMe] = useState<HrMe | null>(null)
  const [loading, setLoading] = useState(true)
  const [reason, setReason] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let live = true
    setLoading(true)
    hr<HrMe>('/me')
      .then((m) => live && (setMe(m), setReason(null)))
      .catch((e: unknown) => live && (setMe(null), setReason(e instanceof Error ? e.message : null)))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [user?.id])

  const value = useMemo<HrState>(() => {
    const caps = new Set(me?.caps ?? [])
    return {
      me,
      loading,
      reason,
      can: (c) => caps.has(c),
      partTime: !!user && user.role !== 'AZM_HR',
      side: location.pathname.startsWith('/hr') || user?.role === 'AZM_HR' ? 'hr' : 'parttime',
    }
  }, [me, loading, reason, user, location.pathname])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useHr(): HrState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useHr outside HrProvider')
  return v
}
