import { Badge } from '@/components/shadcn/badge'
import type { Standing, StandingLevel } from '../api/types'

// Metal colours for the three earned levels; New is plain. Standing is not a
// tier (see server/src/services/standing.ts), so it does not share TIER_COLORS.
const DOT: Record<StandingLevel, string> = {
  NEW: 'var(--muted)',
  BRONZE: '#B0703C',
  SILVER: '#9AA0A6',
  GOLD: 'var(--gold)',
}

/**
 * A Tasker's earned standing, with badges listed after it. Hovering shows what
 * the next level still needs - the same words the Tasker sees in the app.
 */
export default function StandingBadge({ standing }: { standing?: Standing | null }) {
  if (!standing) return null
  const title = standing.next
    ? `For ${standing.next.label}: ${standing.next.needs.join('; ')}`
    : 'Highest standing'
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <Badge variant="outline" className="tier" title={title}>
        <span className="d" style={{ background: DOT[standing.level] }} />
        {standing.label}
      </Badge>
      {standing.badges.map((b) => (
        <Badge variant="outline" className="tier" key={b.key}>
          {b.label}
        </Badge>
      ))}
    </span>
  )
}
