import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { api } from '../api/client'
import type { TierRow } from '../api/types'
import { useApi } from './useApi'
import { TIER_COLORS, TIER_LABELS } from './format'

/**
 * Tiers come from the server (Settings > Tiers), so one an admin adds shows up
 * everywhere without a deploy. The five built-ins are the fallback while the
 * list loads, or if it cannot.
 */
interface TiersState {
  /** Every tier, active and not, in order. */
  all: TierRow[]
  /** The ones that can be picked for new work. */
  active: TierRow[]
  label: (key: string) => string
  color: (key: string) => string
  reload: () => void
}

const FALLBACK: TierRow[] = Object.entries(TIER_LABELS).map(([key, label], i) => ({
  key,
  label,
  description: null,
  docLabel: null,
  active: true,
  sortOrder: i + 1,
}))
const EXTRA_COLORS = ['var(--clay)', 'var(--gold)', 'var(--indigo)', 'var(--forest)', 'var(--money)', 'var(--amber)']

const Ctx = createContext<TiersState | null>(null)

export function TiersProvider({ children }: { children: ReactNode }) {
  const { data, reload } = useApi((signal) => api.tiers(signal))
  const all = useMemo(() => (data && data.length ? data : FALLBACK), [data])
  const label = useCallback(
    (key: string) => all.find((t) => t.key === key)?.label ?? TIER_LABELS[key] ?? key.charAt(0) + key.slice(1).toLowerCase(),
    [all]
  )
  const color = useCallback(
    (key: string) => TIER_COLORS[key] ?? EXTRA_COLORS[Math.max(0, all.findIndex((t) => t.key === key)) % EXTRA_COLORS.length],
    [all]
  )
  const value = useMemo(() => ({ all, active: all.filter((t) => t.active), label, color, reload }), [all, label, color, reload])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTiers(): TiersState {
  const v = useContext(Ctx)
  if (v) return v
  // Outside the provider (e.g. a test): built-ins only.
  return {
    all: FALLBACK,
    active: FALLBACK,
    label: (k) => TIER_LABELS[k] ?? k,
    color: (k) => TIER_COLORS[k] ?? 'var(--muted)',
    reload: () => {},
  }
}
