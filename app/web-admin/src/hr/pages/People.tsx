import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../../components/PageHeader'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Switch from '../../components/ui/Switch'
import { useApi } from '../../lib/useApi'
import { ago, hr, hrFile, niceDate, productLabel, STAFF_TYPES } from '../api'
import { ErrorLine, Load, Muted, Section, Status, Table, Tabs, Tag, TypeTag, useAction } from '../ui'

export interface DirPerson {
  userId: string
  name: string | null
  email: string | null
  jobTitle: string | null
  department: string | null
  owner: boolean
  managerId: string | null
  managerName: string | null
  staffType: string
  status: string
  hasFile: boolean
  employeeNo: string | null
  startDate: string | null
  products: string[]
  lastSeenAt: string | null
}

export default function HrPeople() {
  const [view, setView] = useState<'list' | 'org'>('list')
  const [type, setType] = useState('')
  const [product, setProduct] = useState('')
  const [q, setQ] = useState('')
  const [exited, setExited] = useState(false)
  const r = useApi((signal) => hr<DirPerson[]>(`/directory?exited=${exited ? 1 : 0}`, { signal }), [exited])
  const nav = useNavigate()
  const act = useAction()

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (r.data ?? []).filter(
      (p) =>
        (!type || p.staffType === type) &&
        (!product || p.products.includes(product)) &&
        (!s || `${p.name} ${p.email} ${p.jobTitle} ${p.department}`.toLowerCase().includes(s)),
    )
  }, [r.data, type, product, q])

  return (
    <>
      <PageHeader
        crumb="AZM Staff"
        title="People"
        sub="Every AZM staff member and intern, across all products. Access is managed by each product admin; HR keeps the employee file."
        actions={
          <Button variant="glass" icon="download" loading={act.busy === 'csv'} onClick={() => act.run('csv', () => hrFile('/directory.csv', { download: 'azm-staff.csv' }))}>
            Export CSV
          </Button>
        }
      />
      <ErrorLine error={act.error} />
      <Tabs value={view} onChange={setView} tabs={[{ value: 'list', label: 'Directory' }, { value: 'org', label: 'Org chart' }]} />
      <Section pad={false}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: 16, alignItems: 'center' }}>
          <div style={{ flex: '1 1 220px' }}>
            <Input aria-label="Search" placeholder="Search name, email, title, department" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div style={{ width: 160 }}>
            <Select ariaLabel="Staff type" value={type} onChange={setType} options={[{ value: '', label: 'All types' }, ...STAFF_TYPES]} />
          </div>
          <div style={{ width: 170 }}>
            <Select ariaLabel="Product" value={product} onChange={setProduct} options={[{ value: '', label: 'All products' }, ...['STOREFRONT', 'SUPPLIER_OPS', 'INK', 'HUD', 'PARTTIME'].map((p) => ({ value: p, label: productLabel(p) }))]} />
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <Switch checked={exited} onChange={setExited} label="Include people who left" /> Include people who left
          </label>
        </div>
        <Load r={r}>
          {() =>
            view === 'list' ? (
              <Table
                rows={rows}
                rowKey={(p) => p.userId}
                onRow={(p) => nav(`/hr/people/${p.userId}`)}
                empty="No one matches"
                emptyIcon="users"
                cols={[
                  {
                    label: 'Person',
                    render: (p) => (
                      <div>
                        <b>{p.name ?? 'Unnamed'}</b> <TypeTag t={p.staffType} /> {p.owner && <Tag tone="warn">Owner</Tag>}
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.email}</div>
                      </div>
                    ),
                  },
                  { label: 'Role', render: (p) => <div>{p.jobTitle ?? <Muted>—</Muted>}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.department ?? ''}</div></div> },
                  { label: 'Reports to', render: (p) => p.managerName ?? <Muted>—</Muted> },
                  { label: 'Products', render: (p) => (p.products.length ? p.products.map(productLabel).join(', ') : <Muted>No access</Muted>) },
                  { label: 'Started', render: (p) => <span className="tnum">{niceDate(p.startDate)}</span> },
                  { label: 'File', render: (p) => (p.status === 'EXITED' ? <Status s="EXITED" /> : p.hasFile ? <Tag tone="ok">On file</Tag> : <Tag tone="warn">No file</Tag>) },
                  { label: 'Last seen', render: (p) => <Muted>{ago(p.lastSeenAt)}</Muted> },
                ]}
              />
            ) : (
              <OrgChart people={rows} onOpen={(id) => nav(`/hr/people/${id}`)} />
            )
          }
        </Load>
      </Section>
    </>
  )
}

/** Tree from line managers. People whose manager is outside the filter become roots. */
function OrgChart({ people, onOpen }: { people: DirPerson[]; onOpen: (id: string) => void }) {
  const ids = new Set(people.map((p) => p.userId))
  const kids = new Map<string, DirPerson[]>()
  const roots: DirPerson[] = []
  for (const p of people) {
    if (p.managerId && ids.has(p.managerId) && p.managerId !== p.userId) kids.set(p.managerId, [...(kids.get(p.managerId) ?? []), p])
    else roots.push(p)
  }
  const seen = new Set<string>()
  const node = (p: DirPerson, depth: number): JSX.Element | null => {
    if (seen.has(p.userId) || depth > 12) return null
    seen.add(p.userId)
    const children = kids.get(p.userId) ?? []
    return (
      <li key={p.userId} style={{ listStyle: 'none', margin: '6px 0' }}>
        <button
          onClick={() => onOpen(p.userId)}
          className="glass"
          style={{ display: 'inline-flex', gap: 10, alignItems: 'center', padding: '8px 12px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', cursor: 'pointer', textAlign: 'left' }}
        >
          <b style={{ fontSize: 13.5 }}>{p.name}</b>
          <Muted>{p.jobTitle ?? ''}</Muted>
          {p.staffType === 'INTERN' && <TypeTag t="INTERN" />}
          {children.length > 0 && <Tag>{children.length}</Tag>}
        </button>
        {children.length > 0 && <ul style={{ paddingLeft: 26, borderLeft: '2px solid var(--line)', marginLeft: 14 }}>{children.map((c) => node(c, depth + 1))}</ul>}
      </li>
    )
  }
  // Managers first, so the tree reads top-down.
  roots.sort((a, b) => (kids.get(b.userId)?.length ?? 0) - (kids.get(a.userId)?.length ?? 0))
  return <ul style={{ padding: '4px 16px 16px' }}>{roots.map((r) => node(r, 0))}</ul>
}
