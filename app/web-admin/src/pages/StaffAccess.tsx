/**
 * Staff access: who can work in which Afrizonemart product (storefront admin,
 * supplier portal, Ink, HUD, Part-Time), managed in one place.
 *
 * Changes are made in the Afrizonemart API as the signed-in Owner (see
 * lib/martStaff.ts) and take effect everywhere; Part-Time picks up its own
 * roles through the staff-roles sync. PLANNING/STAFF_ACCESS_HARDENING.md.
 */
import { useEffect, useMemo, useState } from 'react'
import PageHeader from '../components/PageHeader'
import Glass from '../components/ui/Glass'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Input from '../components/ui/Input'
import Switch from '../components/ui/Switch'
import StatusPill from '../components/ui/StatusPill'
import Icon from '../components/Icon'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateView'
import { Label } from '@/components/shadcn/label'
import { Checkbox } from '@/components/shadcn/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/shadcn/table'
import { formatDate } from '../lib/format'
import {
  connectMart,
  connectMartSilently,
  disconnectMart,
  martStaff,
  MartError,
  type MartMembership,
  type MartProduct,
  type MartProductCatalogue,
  type MartStaff,
} from '../lib/martStaff'

const PRODUCT_SHORT: Record<MartProduct, string> = {
  STOREFRONT: 'Storefront',
  SUPPLIER_OPS: 'Supplier Ops',
  INK: 'Ink',
  HUD: 'HUD',
  PARTTIME: 'Part-Time',
}

const DAY = 86_400_000

function errText(e: unknown, fallback: string): string {
  if (e instanceof MartError) {
    if (/password is required/i.test(e.message)) {
      return 'No Afrizonemart account uses that email. Ask them to sign up at afrizonemart.com first, then add them here.'
    }
    return e.message
  }
  return e instanceof Error ? e.message : fallback
}

/** Contract state of a membership, for the pills. */
function contractState(m: Pick<MartMembership, 'startsAt' | 'endsAt'>, now = Date.now()) {
  if (new Date(m.startsAt).getTime() > now) return { variant: 'pending' as const, label: `Starts ${formatDate(m.startsAt)}` }
  if (!m.endsAt) return null
  const left = new Date(m.endsAt).getTime() - now
  if (left <= 0) return { variant: 'danger' as const, label: 'Contract ended' }
  if (left <= 14 * DAY) return { variant: 'review' as const, label: `Ends in ${Math.ceil(left / DAY)}d` }
  return null
}

/** yyyy-mm-dd for <input type="date">, from an ISO string. */
function dateInput(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : ''
}

export default function StaffAccess() {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [connectErr, setConnectErr] = useState<string | null>(null)

  const [staff, setStaff] = useState<MartStaff[] | null>(null)
  const [catalogue, setCatalogue] = useState<MartProductCatalogue[]>([])
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [query, setQuery] = useState('')
  const [productFilter, setProductFilter] = useState<MartProduct | 'ALL'>('ALL')
  const [managing, setManaging] = useState<MartStaff | null>(null)
  const [adding, setAdding] = useState(false)

  async function load() {
    setLoading(true)
    setLoadErr(null)
    try {
      const [items, products] = await Promise.all([martStaff.list(), martStaff.catalogue()])
      setStaff(items)
      setCatalogue(products)
    } catch (e) {
      if (e instanceof MartError && e.status === 401) setConnected(false)
      setLoadErr(errText(e, 'Could not load staff'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let live = true
    connectMartSilently().then((ok) => {
      if (!live) return
      setConnected(ok)
      if (ok) void load()
    })
    return () => {
      live = false
      disconnectMart()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function connect() {
    setConnecting(true)
    setConnectErr(null)
    try {
      await connectMart()
      setConnected(true)
      await load()
    } catch (e) {
      setConnectErr(errText(e, 'Could not connect'))
    } finally {
      setConnecting(false)
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (staff ?? []).filter((s) => {
      if (s.role === 'SELLER') return false
      if (productFilter !== 'ALL' && s.role !== 'ADMIN' && !s.staffMemberships.some((m) => m.product === productFilter)) return false
      if (!q) return true
      return [s.name, s.email, s.jobTitle].some((v) => v?.toLowerCase().includes(q))
    })
  }, [staff, query, productFilter])

  const endingSoon = useMemo(
    () =>
      (staff ?? []).flatMap((s) =>
        s.staffMemberships
          .filter((m) => contractState(m)?.variant === 'review' || contractState(m)?.variant === 'danger')
          .map((m) => ({ s, m })),
      ),
    [staff],
  )

  return (
    <>
      <PageHeader
        crumb="People / Staff access"
        title="Staff access"
        sub="Who can work in which Afrizonemart product. Changes here apply everywhere: storefront admin, supplier portal, Ink, HUD and Part-Time."
        actions={
          connected ? (
            <Button variant="primary" icon="plus" onClick={() => setAdding(true)} disabled={!staff}>
              Add staff
            </Button>
          ) : undefined
        }
      />

      {connected === null ? (
        <LoadingState label="Checking your AfriZone sign-in…" />
      ) : !connected ? (
        <Glass>
          <div style={{ display: 'grid', gap: 12, maxWidth: 560 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <Icon name="key" />
              <b style={{ fontSize: 15 }}>Connect your AfriZone Owner account</b>
            </div>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
              Staff access lives in Afrizonemart, so changes are made with your AfriZone account (with its
              two-factor sign-in) and recorded in its audit log. Only Owners can make changes.
            </p>
            {connectErr && (
              <div className="login-error" role="alert">
                <Icon name="alert" size={15} />
                {connectErr}
              </div>
            )}
            <div>
              <Button variant="primary" icon="key" loading={connecting} onClick={connect}>
                Connect AfriZone
              </Button>
            </div>
          </div>
        </Glass>
      ) : loading && !staff ? (
        <LoadingState label="Loading staff…" />
      ) : loadErr && !staff ? (
        <ErrorState message={loadErr} onRetry={load} />
      ) : (
        <>
          {endingSoon.length > 0 && (
            <Glass>
              <div style={{ display: 'grid', gap: 6 }}>
                <b style={{ fontSize: 14 }}>
                  <Icon name="calendar" size={15} /> Contracts ending
                </b>
                {endingSoon.map(({ s, m }) => (
                  <div key={s.id + m.product} style={{ fontSize: 13 }}>
                    {s.name ?? s.email} · {PRODUCT_SHORT[m.product]} · {contractState(m)?.label} ({formatDate(m.endsAt)})
                  </div>
                ))}
              </div>
            </Glass>
          )}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '14px 0' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <Input
                aria-label="Search staff"
                placeholder="Search name, email or job title"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['ALL', 'STOREFRONT', 'SUPPLIER_OPS', 'INK', 'HUD', 'PARTTIME'] as const).map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={productFilter === p ? 'primary' : 'glass'}
                  onClick={() => setProductFilter(p)}
                >
                  {p === 'ALL' ? 'All' : PRODUCT_SHORT[p]}
                </Button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <Glass>
              <EmptyState icon="users" title="No staff match" sub="Try another search or product." />
            </Glass>
          ) : (
            <Glass className="tablewrap">
              <Table className="dt">
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Access</TableHead>
                    <TableHead>2FA</TableHead>
                    <TableHead>Last sign-in</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <b>{s.name ?? '—'}</b>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                          {s.email}
                          {s.jobTitle ? ` · ${s.jobTitle}` : ''}
                        </div>
                      </TableCell>
                      <TableCell>
                        {s.role === 'ADMIN' ? (
                          <StatusPill variant="ready" label="Owner · everything" />
                        ) : s.staffMemberships.length === 0 ? (
                          <StatusPill variant="danger" label="No product" />
                        ) : (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {s.staffMemberships.map((m) => {
                              const c = contractState(m)
                              return (
                                <StatusPill
                                  key={m.product}
                                  variant={c?.variant ?? 'active'}
                                  label={
                                    PRODUCT_SHORT[m.product] +
                                    (m.role === 'PRODUCT_ADMIN' ? ' · Admin' : '') +
                                    (m.isFinance ? ' · Finance' : '') +
                                    (c ? ` · ${c.label}` : '')
                                  }
                                />
                              )
                            })}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {s.mfaEnabled ? <StatusPill variant="ready" label="On" /> : <StatusPill variant="danger" label="Off" />}
                      </TableCell>
                      <TableCell style={{ whiteSpace: 'nowrap' }}>{formatDate(s.lastLoginAt)}</TableCell>
                      <TableCell style={{ textAlign: 'right' }}>
                        <Button size="sm" variant="glass" onClick={() => setManaging(s)}>
                          {s.role === 'ADMIN' ? 'View' : 'Manage'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Glass>
          )}
        </>
      )}

      {managing && (
        <ManageStaff
          person={managing}
          catalogue={catalogue}
          onClose={() => setManaging(null)}
          onChanged={async () => {
            await load()
          }}
        />
      )}
      {adding && (
        <AddStaff
          catalogue={catalogue}
          onClose={() => setAdding(false)}
          onAdded={async () => {
            setAdding(false)
            await load()
          }}
        />
      )}
    </>
  )
}

/** Capability checklist for one product, grouped by area. */
function CapabilityPicker({
  product,
  catalogue,
  value,
  onChange,
}: {
  product: MartProduct
  catalogue: MartProductCatalogue[]
  value: string[]
  onChange: (next: string[]) => void
}) {
  const caps = catalogue.find((c) => c.product === product)?.capabilities ?? []
  const groups = useMemo(() => {
    const by = new Map<string, typeof caps>()
    for (const c of caps) by.set(c.domain, [...(by.get(c.domain) ?? []), c])
    return [...by.entries()]
  }, [caps])
  const toggle = (key: string) => onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key])

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {groups.map(([domain, list]) => (
        <div key={domain}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted)', marginBottom: 4 }}>
            {domain}
          </div>
          {list.map((c) => (
            <label
              key={c.key}
              style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '5px 0', fontSize: 13, cursor: 'pointer' }}
            >
              <Checkbox checked={value.includes(c.key)} onCheckedChange={() => toggle(c.key)} />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
      ))}
    </div>
  )
}

function ManageStaff({
  person,
  catalogue,
  onClose,
  onChanged,
}: {
  person: MartStaff
  catalogue: MartProductCatalogue[]
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [memberships, setMemberships] = useState<MartMembership[]>(person.staffMemberships)
  const [open, setOpen] = useState<MartProduct | null>(person.staffMemberships[0]?.product ?? null)
  const [confirmRemoveAll, setConfirmRemoveAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (person.role === 'ADMIN') {
    return (
      <Modal open title={person.name ?? person.email} subtitle={person.email} onClose={onClose}>
        <p style={{ fontSize: 13 }}>
          This account is an <b>Owner</b>: full access in every product, including the Owner-only areas (settings,
          payment gateways, webhooks, integrations, feature flags, staff management). Owners are changed by the
          Afrizonemart team directly, not from this screen.
        </p>
      </Modal>
    )
  }

  async function removeAll() {
    setBusy(true)
    setErr(null)
    try {
      await martStaff.removeStaff(person.id)
      await onChanged()
      onClose()
    } catch (e) {
      setErr(errText(e, 'Could not remove'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open size="wide" title={person.name ?? person.email} subtitle={`${person.email}${person.jobTitle ? ` · ${person.jobTitle}` : ''}`} onClose={onClose}>
      {!person.mfaEnabled && (
        <div className="login-error" role="status" style={{ marginBottom: 12 }}>
          <Icon name="alert" size={15} />
          Two-factor is off on this account. They can sign in, but can't do any staff work until they turn it on.
        </div>
      )}
      <div style={{ display: 'grid', gap: 10 }}>
        {catalogue.map((c) => (
          <ProductAccess
            key={c.product}
            userId={person.id}
            product={c.product}
            label={c.label}
            catalogue={catalogue}
            membership={memberships.find((m) => m.product === c.product) ?? null}
            expanded={open === c.product}
            onToggle={() => setOpen(open === c.product ? null : c.product)}
            onSaved={async (m) => {
              setMemberships((prev) => [...prev.filter((x) => x.product !== c.product), ...(m ? [m] : [])])
              await onChanged()
            }}
          />
        ))}
      </div>
      {err && (
        <div className="login-error" role="alert" style={{ marginTop: 12 }}>
          <Icon name="alert" size={15} />
          {err}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginTop: 16, flexWrap: 'wrap' }}>
        {confirmRemoveAll ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13 }}>Remove all staff access? Their account stays, as a shopper.</span>
            <Button variant="danger" size="sm" loading={busy} onClick={removeAll}>
              Yes, remove
            </Button>
            <Button variant="glass" size="sm" onClick={() => setConfirmRemoveAll(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="danger" size="sm" onClick={() => setConfirmRemoveAll(true)}>
            Remove all staff access
          </Button>
        )}
        <Button variant="glass" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  )
}

function ProductAccess({
  userId,
  product,
  label,
  catalogue,
  membership,
  expanded,
  onToggle,
  onSaved,
}: {
  userId: string
  product: MartProduct
  label: string
  catalogue: MartProductCatalogue[]
  membership: MartMembership | null
  expanded: boolean
  onToggle: () => void
  onSaved: (m: MartMembership | null) => Promise<void>
}) {
  const [permissions, setPermissions] = useState<string[]>(membership?.permissions ?? [])
  const [productAdmin, setProductAdmin] = useState(membership?.role === 'PRODUCT_ADMIN')
  const [isFinance, setIsFinance] = useState(membership?.isFinance ?? false)
  const [startsAt, setStartsAt] = useState(dateInput(membership?.startsAt))
  const [endsAt, setEndsAt] = useState(dateInput(membership?.endsAt))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const contract = membership ? contractState(membership) : null

  async function save() {
    setBusy(true)
    setErr(null)
    setSaved(false)
    try {
      const m = await martStaff.setMembership(userId, product, {
        permissions,
        role: productAdmin ? 'PRODUCT_ADMIN' : 'MEMBER',
        isFinance,
        startsAt: startsAt ? new Date(`${startsAt}T00:00:00`).toISOString() : undefined,
        endsAt: endsAt ? new Date(`${endsAt}T23:59:59`).toISOString() : null,
      })
      await onSaved(m)
      setSaved(true)
    } catch (e) {
      setErr(errText(e, 'Could not save'))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setErr(null)
    try {
      await martStaff.removeMembership(userId, product)
      setPermissions([])
      setProductAdmin(false)
      setIsFinance(false)
      setStartsAt('')
      setEndsAt('')
      await onSaved(null)
    } catch (e) {
      setErr(errText(e, 'Could not remove'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Glass>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        style={{ all: 'unset', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center', width: '100%', flexWrap: 'wrap' }}
      >
        <b style={{ flex: 1, fontSize: 14 }}>{label}</b>
        {membership ? (
          <>
            {membership.role === 'PRODUCT_ADMIN' && <StatusPill variant="ready" label="Product Admin" />}
            {membership.isFinance && <StatusPill variant="paid" label="Finance" />}
            {contract && <StatusPill variant={contract.variant} label={contract.label} />}
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {membership.permissions.length} permission{membership.permissions.length === 1 ? '' : 's'}
            </span>
          </>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>No access</span>
        )}
        <Icon name={expanded ? 'x' : 'plus'} size={15} />
      </button>

      {expanded && (
        <div style={{ display: 'grid', gap: 14, marginTop: 14 }}>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <div className="field">
              <Label htmlFor={`${product}-start`}>Contract starts</Label>
              <Input id={`${product}-start`} type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div className="field">
              <Label htmlFor={`${product}-end`}>Contract ends (access stops)</Label>
              <Input id={`${product}-end`} type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Switch checked={productAdmin} onChange={setProductAdmin} label={`${label}: Product Admin`} />
              <span style={{ fontSize: 13 }}>Product Admin (runs this product's staff)</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Switch checked={isFinance} onChange={setIsFinance} label={`${label}: Finance`} />
              <span style={{ fontSize: 13 }}>Finance (approves this product's money actions)</span>
            </div>
          </div>
          <CapabilityPicker product={product} catalogue={catalogue} value={permissions} onChange={setPermissions} />
          {err && (
            <div className="login-error" role="alert">
              <Icon name="alert" size={15} />
              {err}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
            {saved && !busy && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Saved. Applies on their next request.</span>}
            {membership && (
              <Button variant="danger" size="sm" loading={busy} onClick={remove}>
                Remove {PRODUCT_SHORT[product]} access
              </Button>
            )}
            <Button variant="primary" size="sm" loading={busy} disabled={permissions.length === 0} onClick={save}>
              {membership ? 'Save' : 'Give access'}
            </Button>
          </div>
        </div>
      )}
    </Glass>
  )
}

function AddStaff({
  catalogue,
  onClose,
  onAdded,
}: {
  catalogue: MartProductCatalogue[]
  onClose: () => void
  onAdded: () => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [product, setProduct] = useState<MartProduct>('STOREFRONT')
  const [permissions, setPermissions] = useState<string[]>([])
  const [endsAt, setEndsAt] = useState('')
  const [isFinance, setIsFinance] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function add() {
    setBusy(true)
    setErr(null)
    try {
      const person = await martStaff.promote({
        email: email.trim().toLowerCase(),
        name: name.trim() || undefined,
        jobTitle: jobTitle.trim() || undefined,
        permissions,
      })
      // Set the chosen product exactly, then drop anything else the
      // one-list rule may have opened from a shared permission.
      await martStaff.setMembership(person.id, product, {
        permissions,
        isFinance,
        endsAt: endsAt ? new Date(`${endsAt}T23:59:59`).toISOString() : null,
      })
      const others = (await martStaff.list()).find((s) => s.id === person.id)?.staffMemberships ?? []
      for (const m of others) if (m.product !== product) await martStaff.removeMembership(person.id, m.product)
      await onAdded()
    } catch (e) {
      setErr(errText(e, 'Could not add'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open size="wide" title="Add staff" subtitle="Give an existing Afrizonemart account staff access. They keep their own login." onClose={onClose}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="field">
          <Label htmlFor="add-email">Their Afrizonemart account email</Label>
          <Input id="add-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <Label htmlFor="add-name">Name (optional)</Label>
            <Input id="add-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <Label htmlFor="add-title">Job title (optional)</Label>
            <Input id="add-title" value={jobTitle} maxLength={80} onChange={(e) => setJobTitle(e.target.value)} placeholder="Intern" />
          </div>
        </div>
        <div>
          <Label>Product</Label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {catalogue.map((c) => (
              <Button
                key={c.product}
                size="sm"
                variant={product === c.product ? 'primary' : 'glass'}
                onClick={() => {
                  setProduct(c.product)
                  setPermissions([])
                }}
              >
                {PRODUCT_SHORT[c.product]}
              </Button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field">
            <Label htmlFor="add-end">Contract ends (optional)</Label>
            <Input id="add-end" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Switch checked={isFinance} onChange={setIsFinance} label="Finance for this product" />
            <span style={{ fontSize: 13 }}>Finance for this product</span>
          </div>
        </div>
        <CapabilityPicker product={product} catalogue={catalogue} value={permissions} onChange={setPermissions} />
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
          They'll need two-factor turned on before they can do any staff work, and they sign in from the {PRODUCT_SHORT[product]} admin.
          Add more products after, from Manage.
        </p>
        {err && (
          <div className="login-error" role="alert">
            <Icon name="alert" size={15} />
            {err}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button variant="glass" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!email.includes('@') || permissions.length === 0} onClick={add}>
            Add staff
          </Button>
        </div>
      </div>
    </Modal>
  )
}
