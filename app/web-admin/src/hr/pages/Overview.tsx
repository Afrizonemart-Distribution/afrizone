import { Link, useNavigate } from 'react-router-dom'
import PageHeader from '../../components/PageHeader'
import Glass from '../../components/ui/Glass'
import { useApi } from '../../lib/useApi'
import { hr, niceDate } from '../api'
import { useHr } from '../HrContext'
import { Grid, Load, Muted, Section, Stat, Tag } from '../ui'

interface Overview {
  live: { date: string; isWorkday: boolean; totals: { staff: number; online: number; away: number; onLeave: number; notIn: number; late: number } }
  alerts: { level: 'critical' | 'warn' | 'info'; kind: string; text: string; userId?: string; name?: string | null; link?: string }[]
  alertCounts: { critical: number; warn: number; info: number }
  celebrations: { userId: string; name: string | null; kind: 'BIRTHDAY' | 'ANNIVERSARY'; date: string; inDays: number; years?: number }[]
  leaveWaiting: number
  claimsWaiting: number
  payroll: { id: string; period: string; status: string } | null
}

const LEVEL: Record<string, 'bad' | 'warn' | undefined> = { critical: 'bad', warn: 'warn', info: undefined }

export default function HrOverview() {
  const r = useApi((signal) => hr<Overview>('/overview', { signal }), [])
  const { me } = useHr()
  const nav = useNavigate()
  return (
    <>
      <PageHeader crumb="AZM HR Console" title={`Good day${me?.name ? `, ${me.name.split(' ')[0]}` : ''}`} sub="Who is working, what needs you, and what is coming up across every AZM product admin." />
      <Load r={r}>
        {(d) => (
          <>
            <Grid min={170}>
              <Stat label="Working now" value={d.live.totals.online} icon="check-circle" tone="var(--money)" hint={`of ${d.live.totals.staff} staff`} onClick={() => nav('/hr/live')} />
              <Stat label="Not in yet" value={d.live.isWorkday ? d.live.totals.notIn : '—'} icon="clock" tone="var(--danger)" hint={d.live.isWorkday ? 'workday, no leave booked' : 'not a workday'} onClick={() => nav('/hr/live')} />
              <Stat label="Late today" value={d.live.totals.late} icon="alert" tone="var(--amber)" onClick={() => nav('/hr/attendance')} />
              <Stat label="On leave" value={d.live.totals.onLeave} icon="calendar" tone="var(--indigo)" onClick={() => nav('/hr/leave')} />
              <Stat label="Leave to approve" value={d.leaveWaiting} icon="file" onClick={() => nav('/hr/leave')} />
              <Stat label="Claims to handle" value={d.claimsWaiting} icon="naira" onClick={() => nav('/hr/claims')} />
            </Grid>
            <div style={{ height: 16 }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(380px, 100%), 1fr))', gap: 16 }}>
              <Section
                title="Needs attention"
                sub={`${d.alertCounts.critical} critical · ${d.alertCounts.warn} to act on · ${d.alertCounts.info} to know`}
                actions={<Link to="/hr/alerts" className="btn btn-glass btn-sm">All alerts</Link>}
              >
                {d.alerts.length === 0 ? (
                  <Muted>All clear. Nothing needs HR right now.</Muted>
                ) : (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {d.alerts.map((a, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                        <Tag tone={LEVEL[a.level]}>{a.level === 'critical' ? 'Critical' : a.level === 'warn' ? 'Act' : 'Note'}</Tag>
                        <div style={{ fontSize: 13.5 }}>
                          {a.userId ? <Link to={`/hr/people/${a.userId}`} style={{ fontWeight: 700 }}>{a.name ?? 'Someone'}</Link> : null}
                          {a.userId ? ': ' : ''}
                          {a.text}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
              <div>
                <Section title="Coming up" sub="Birthdays and work anniversaries in the next two weeks">
                  {d.celebrations.length === 0 ? (
                    <Muted>Nothing in the next two weeks.</Muted>
                  ) : (
                    <div style={{ display: 'grid', gap: 8 }}>
                      {d.celebrations.map((c) => (
                        <div key={c.userId + c.kind} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13.5 }}>
                          <Tag tone={c.kind === 'BIRTHDAY' ? 'warn' : 'ok'}>{c.kind === 'BIRTHDAY' ? 'Birthday' : `${c.years} yr${c.years === 1 ? '' : 's'}`}</Tag>
                          <Link to={`/hr/people/${c.userId}`} style={{ fontWeight: 700 }}>{c.name}</Link>
                          <Muted>{c.inDays === 0 ? 'today' : `${niceDate(c.date)} · in ${c.inDays} day${c.inDays === 1 ? '' : 's'}`}</Muted>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
                {d.payroll && (
                  <Glass style={{ padding: 18 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <b>Payroll {d.payroll.period}</b>
                      <Tag>{d.payroll.status.toLowerCase()}</Tag>
                      <span style={{ flex: 1 }} />
                      <Link to={`/hr/payroll/${d.payroll.id}`} className="btn btn-glass btn-sm">Open</Link>
                    </div>
                  </Glass>
                )}
              </div>
            </div>
          </>
        )}
      </Load>
    </>
  )
}
