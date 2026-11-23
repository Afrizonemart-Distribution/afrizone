import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../../components/PageHeader'
import Select from '../../components/ui/Select'
import { useApi } from '../../lib/useApi'
import { ago, hours, hr, niceTime, productLabel } from '../api'
import { Grid, Load, Muted, Section, Stat, Status, Table, Tag, Tabs, TypeTag } from '../ui'
import { PersonCell, PresenceBoard, type Presence } from '../charts'

const PRESENCE: Record<Person['state'], Presence> = { ONLINE: 'online', AWAY: 'away', ON_LEAVE: 'leave', NOT_IN: 'off', OFF_DAY: 'off' }

interface Person {
  userId: string
  name: string | null
  jobTitle: string | null
  department: string | null
  staffType: string
  products: string[]
  state: 'ONLINE' | 'AWAY' | 'ON_LEAVE' | 'NOT_IN' | 'OFF_DAY'
  workingIn: string | null
  firstSeenAt: string | null
  late: boolean
  todayActiveSeconds: number
  leave: string | null
  lastSeenAt: string | null
}
interface Board {
  date: string
  isWorkday: boolean
  workday: { start: string; end: string; graceMinutes: number }
  totals: { staff: number; online: number; away: number; onLeave: number; notIn: number; late: number }
  people: Person[]
}

/** Who is working right now, across every product admin. Refreshes every minute. */
export default function HrLive() {
  const r = useApi((signal) => hr<Board>('/live', { signal }), [])
  const [tab, setTab] = useState<'all' | Person['state']>('all')
  const [product, setProduct] = useState('')
  const nav = useNavigate()
  useEffect(() => {
    const t = setInterval(r.reload, 60_000)
    return () => clearInterval(t)
  }, [r.reload])

  const rows = useMemo(
    () => (r.data?.people ?? []).filter((p) => (tab === 'all' || p.state === tab) && (!product || p.products.includes(product))),
    [r.data, tab, product],
  )

  return (
    <>
      <PageHeader crumb="AZM Staff · Visibility" title="Who's working" sub="From the online signal every product admin sends. Updates every minute; nothing here is editable." />
      <Load r={r}>
        {(d) => (
          <>
            <Grid min={160}>
              <Stat label="Working now" value={d.totals.online} icon="check-circle" tone="var(--money)" />
              <Stat label="Was in, now away" value={d.totals.away} icon="clock" />
              <Stat label="Not in" value={d.isWorkday ? d.totals.notIn : '—'} icon="alert" tone="var(--danger)" hint={d.isWorkday ? `workday ${d.workday.start}–${d.workday.end}` : 'not a workday'} />
              <Stat label="On leave" value={d.totals.onLeave} icon="calendar" tone="var(--indigo)" />
              <Stat label="Late today" value={d.totals.late} icon="alert" tone="var(--amber)" hint={`after ${d.workday.start} + ${d.workday.graceMinutes} min`} />
            </Grid>
            <div style={{ height: 16 }} />
            <PresenceBoard
              people={d.people.map((p) => ({
                userId: p.userId,
                name: p.name,
                presence: PRESENCE[p.state],
                intern: p.staffType === 'INTERN',
                detail: p.state === 'ONLINE' && p.workingIn ? `in ${productLabel(p.workingIn)}` : p.state === 'ON_LEAVE' ? (p.leave ?? 'on leave') : p.state === 'NOT_IN' ? 'not in yet' : p.state === 'AWAY' ? `last seen ${ago(p.lastSeenAt)}` : 'day off',
              }))}
            />
            <Section
              pad={false}
              title={`Today · ${d.people.length} staff`}
              actions={
                <div style={{ minWidth: 180 }}>
                  <Select ariaLabel="Product" value={product} onChange={setProduct} options={[{ value: '', label: 'Every product' }, ...['STOREFRONT', 'SUPPLIER_OPS', 'INK', 'HUD', 'PARTTIME'].map((p) => ({ value: p, label: productLabel(p) }))]} />
                </div>
              }
            >
              <div style={{ padding: '0 20px' }}>
                <Tabs
                  value={tab}
                  onChange={setTab}
                  tabs={[
                    { value: 'all', label: 'Everyone' },
                    { value: 'ONLINE', label: 'Working now', count: d.totals.online },
                    { value: 'AWAY', label: 'Away', count: d.totals.away },
                    { value: 'NOT_IN', label: 'Not in', count: d.totals.notIn },
                    { value: 'ON_LEAVE', label: 'On leave', count: d.totals.onLeave },
                  ]}
                />
              </div>
              <Table
                rows={rows}
                rowKey={(p) => p.userId}
                onRow={(p) => nav(`/hr/people/${p.userId}`)}
                empty="Nobody in this group right now"
                emptyIcon="users"
                cols={[
                  {
                    label: 'Person',
                    render: (p) => (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <PersonCell userId={p.userId} name={p.name} presence={PRESENCE[p.state]} intern={p.staffType === 'INTERN'} sub={[p.jobTitle, p.department].filter(Boolean).join(' · ') || '—'} />
                        <TypeTag t={p.staffType} />
                      </span>
                    ),
                  },
                  { label: 'Now', render: (p) => <Status s={p.state} label={p.state === 'ON_LEAVE' && p.leave ? p.leave : undefined} /> },
                  { label: 'Working in', render: (p) => (p.workingIn ? <Tag tone="ok">{productLabel(p.workingIn)}</Tag> : <Muted>{p.products.map(productLabel).join(', ') || 'No product access'}</Muted>) },
                  { label: 'First in', render: (p) => (p.firstSeenAt ? <span className="tnum">{niceTime(p.firstSeenAt)} {p.late && <Tag tone="warn">late</Tag>}</span> : <Muted>—</Muted>) },
                  { label: 'Active today', render: (p) => <span className="tnum">{hours(p.todayActiveSeconds)}</span>, align: 'right' },
                  { label: 'Last seen', render: (p) => <Muted>{ago(p.lastSeenAt)}</Muted> },
                ]}
              />
            </Section>
          </>
        )}
      </Load>
    </>
  )
}
