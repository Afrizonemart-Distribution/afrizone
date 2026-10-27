import { useMemo, useState, type FormEvent } from 'react'
import { api, ApiError } from '../api/client'
import { useApi } from '../lib/useApi'
import { auditPill, formatDate, orgPill } from '../lib/format'
import { Link } from 'react-router-dom'
import type { CacStatus, CreateOrgBody, OrgKind, OrgStatus, Organization } from '../api/types'
import PageHeader from '../components/PageHeader'
import Glass from '../components/ui/Glass'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import StatusPill from '../components/ui/StatusPill'
import Input from '../components/ui/Input'
import Select from '../components/ui/Select'
import Textarea from '../components/ui/Textarea'
import Icon from '../components/Icon'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateView'
import { Label } from '@/components/shadcn/label'
import { Badge } from '@/components/shadcn/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/shadcn/table'
import { useAuth } from '../auth/AuthContext'
import './Organizations.css'

/**
 * Stores and courier companies.
 *
 * This screen exists because approval is the gate on everything else: a
 * business cannot receive orders or be paid until an admin moves it to ACTIVE,
 * and until this page existed the only way to do that was by hand against the
 * API. The awaiting-approval count is therefore the headline, not a detail.
 *
 * INDIVIDUAL COURIERS DO NOT APPEAR HERE, and that is not an omission. Someone
 * delivering on their own bike is a plain worker with accountType COURIER and
 * no organization at all - they are on the Workers page. Only businesses have a
 * row in this table.
 */

const KIND_TABS: { key: OrgKind | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'STORE', label: 'Stores' },
  { key: 'COURIER', label: 'Couriers' },
]

/**
 * ANY is a real value, not an empty string. Radix Select reserves "" to mean
 * "nothing selected", so an option with that value renders as a blank control
 * with no label at all - which is what this filter did until someone looked at
 * it. The sentinel is translated back to undefined at the call site.
 */
const ANY = 'ANY'

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: ANY, label: 'Any status' },
  { value: 'PENDING', label: 'Awaiting approval' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'SUSPENDED', label: 'Suspended' },
]

function kindLabel(kind: OrgKind): string {
  return kind === 'COURIER' ? 'Courier company' : 'Store'
}

export default function Organizations() {
  const { user } = useAuth()
  const canEdit = user?.role === 'SUPER_ADMIN'
  // Reviewing a registration number is the same class of act as reviewing a
  // worker's KYC, so it is the same people. Approving the business stays with a
  // super admin.
  const canReview = user?.role === 'SUPER_ADMIN' || user?.role === 'TASK_MANAGER'

  const [kind, setKind] = useState<OrgKind | 'ALL'>('ALL')
  const [status, setStatus] = useState(ANY)
  const { data, loading, error, reload, setData } = useApi(
    (signal) =>
      api.organizations(
        {
          kind: kind === 'ALL' ? undefined : kind,
          status: status === ANY ? undefined : (status as OrgStatus),
        },
        signal,
      ),
    [kind, status],
  )

  const [newOpen, setNewOpen] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const orgs = useMemo(() => data ?? [], [data])
  // Counted from the fetched page rather than a second request. It is the
  // number an admin opens this screen to see, so it should not need a filter
  // change to become visible.
  const awaiting = orgs.filter((o) => o.status === 'PENDING').length

  function upsert(updated: Organization) {
    setData((prev) => {
      const list = prev ?? []
      return list.some((o) => o.id === updated.id)
        ? list.map((o) => (o.id === updated.id ? { ...o, ...updated } : o))
        : [updated, ...list]
    })
  }

  return (
    <>
      <PageHeader
        crumb="People / Organizations"
        title="Organizations"
        sub={
          loading
            ? 'Loading…'
            : awaiting > 0
              ? `${orgs.length} total · ${awaiting} awaiting approval`
              : `${orgs.length} total · none awaiting approval`
        }
        actions={
          canEdit ? (
            <Button variant="primary" size="sm" icon="plus" onClick={() => setNewOpen(true)}>
              Register
            </Button>
          ) : undefined
        }
      />

      {!canEdit && (
        <div className="login-error" role="status" style={{ marginBottom: 16 }}>
          <Icon name="alert" size={15} />
          You can view organizations, but approving or registering one requires the SUPER_ADMIN
          role.
        </div>
      )}

      <div className="orgfilters">
        <div className="orgtabs" role="tablist" aria-label="Kind">
          {KIND_TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={kind === t.key}
              className={`orgtab ${kind === t.key ? 'on' : ''}`}
              onClick={() => setKind(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Select
          id="org-status"
          value={status}
          onChange={setStatus}
          options={STATUS_OPTIONS}
          ariaLabel="Filter by status"
          className="w-[210px]"
        />
      </div>

      {loading ? (
        <LoadingState label="Loading organizations…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : orgs.length === 0 ? (
        <Glass>
          <EmptyState
            icon="shield"
            title="Nothing here"
            sub={
              status !== ANY || kind !== 'ALL'
                ? 'No organization matches these filters.'
                : 'Register a store or a courier company to get started.'
            }
            action={
              canEdit ? (
                <Button variant="primary" size="sm" icon="plus" onClick={() => setNewOpen(true)}>
                  Register
                </Button>
              ) : undefined
            }
          />
        </Glass>
      ) : (
        <Glass reveal delay="d1" className="tablewrap">
          <Table className="dt">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Where</TableHead>
                <TableHead>People</TableHead>
                <TableHead>Payout</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgs.map((o) => {
                const pill = orgPill(o.status)
                return (
                  <TableRow key={o.id}>
                    <TableCell>
                      <div className="orgname">
                        <span className={`orgdot ${o.kind.toLowerCase()}`} />
                        <div>
                          <b>{o.name}</b>
                          <span className="orgslug">{o.slug}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="tier">
                        {kindLabel(o.kind)}
                      </Badge>
                    </TableCell>
                    <TableCell>{o.address || '—'}</TableCell>
                    <TableCell>
                      {/* Zero owners is the state that makes a business
                          unmanageable, so it is called out rather than shown
                          as a bare number. */}
                      {o.memberCount === 0 ? (
                        <span className="orgwarn">No one yet</span>
                      ) : (
                        `${o.memberCount ?? 0}`
                      )}
                    </TableCell>
                    <TableCell>{o.bankMasked || <span className="orgwarn">Not set</span>}</TableCell>
                    <TableCell>
                      <StatusPill variant={pill.variant} label={pill.label} />
                    </TableCell>
                    <TableCell>
                      <Button variant="glass" size="sm" onClick={() => setOpenId(o.id)}>
                        Open
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Glass>
      )}

      <NewOrgModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(o) => {
          upsert(o)
          setNewOpen(false)
          setOpenId(o.id)
        }}
      />

      <OrgDetailModal
        id={openId}
        canEdit={canEdit}
        canReview={canReview}
        onClose={() => setOpenId(null)}
        onChanged={upsert}
      />
    </>
  )
}

/* ===================== Register ===================== */

const EMPTY: CreateOrgBody = {
  name: '',
  kind: 'STORE',
  phone: '',
  email: '',
  address: '',
  bankAccountNumber: '',
  bankCode: '',
  bankName: '',
  ownerEmail: '',
}

function NewOrgModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (o: Organization) => void
}) {
  const [form, setForm] = useState<CreateOrgBody>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof CreateOrgBody>(k: K, v: CreateOrgBody[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      // Blank optional fields are stripped rather than sent as "": the server
      // stores what it is given, and an empty string is not the same as absent.
      const body: CreateOrgBody = { name: form.name.trim(), kind: form.kind }
      for (const k of ['phone', 'email', 'address', 'bankAccountNumber', 'bankCode', 'bankName', 'ownerEmail'] as const) {
        const v = (form[k] ?? '').toString().trim()
        if (v) (body as unknown as Record<string, unknown>)[k] = v
      }
      const created = await api.createOrganization(body)
      setForm(EMPTY)
      onCreated(created)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not register that')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Register an organization"
      subtitle="It starts awaiting approval — nothing reaches it until you approve it"
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="formgrid">
          <div className="field">
            <Label htmlFor="o-name">Name</Label>
            <Input
              id="o-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Ikeja City Mart"
              required
            />
          </div>
          <div className="field">
            <Label htmlFor="o-kind">Kind</Label>
            <Select
              id="o-kind"
              value={form.kind}
              onChange={(v) => set('kind', v as OrgKind)}
              options={[
                { value: 'STORE', label: 'Store' },
                { value: 'COURIER', label: 'Courier company' },
              ]}
            />
          </div>
          <div className="field span2">
            <Label htmlFor="o-addr">Address</Label>
            <Input
              id="o-addr"
              value={form.address ?? ''}
              onChange={(e) => set('address', e.target.value)}
              placeholder="Ikeja City Mall, Alausa, Lagos"
            />
          </div>
          <div className="field">
            <Label htmlFor="o-phone">Phone</Label>
            <Input
              id="o-phone"
              value={form.phone ?? ''}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="+234…"
            />
          </div>
          <div className="field">
            <Label htmlFor="o-email">Email</Label>
            <Input
              id="o-email"
              type="email"
              value={form.email ?? ''}
              onChange={(e) => set('email', e.target.value)}
              placeholder="hello@example.com"
            />
          </div>
          <div className="field span2">
            <Label htmlFor="o-owner">Owner&rsquo;s Afrizone email (optional)</Label>
            <Input
              id="o-owner"
              type="email"
              value={form.ownerEmail ?? ''}
              onChange={(e) => set('ownerEmail', e.target.value)}
              placeholder="They must already have an account"
            />
            {/* An organization with no owner cannot add members, edit itself or
                fix its own payout account. Naming one here is the difference
                between a working business and a support ticket. */}
            <span className="fieldhint">
              Makes them the first owner. Without one, nobody can manage this organization until you
              add someone.
            </span>
          </div>
          <div className="field">
            <Label htmlFor="o-acct">Payout account</Label>
            <Input
              id="o-acct"
              className="tnum"
              value={form.bankAccountNumber ?? ''}
              onChange={(e) => set('bankAccountNumber', e.target.value)}
              placeholder="0123456789"
            />
          </div>
          <div className="field">
            <Label htmlFor="o-bank">Bank</Label>
            <Input
              id="o-bank"
              value={form.bankName ?? ''}
              onChange={(e) => set('bankName', e.target.value)}
              placeholder="GTBank"
            />
          </div>
        </div>

        {error && (
          <div className="login-error" role="alert" style={{ marginTop: 16 }}>
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22 }}>
          <Button type="button" variant="glass" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon="check" loading={busy}>
            Register
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/* ===================== Detail + approval ===================== */

function OrgDetailModal({
  id,
  canEdit,
  canReview,
  onClose,
  onChanged,
}: {
  id: string | null
  canEdit: boolean
  /**
   * Verifying a registration number is not the same act as approving a
   * business, so it is not the same permission: a task manager reviews it, the
   * way they review a worker's KYC. Only a super admin can approve.
   */
  canReview: boolean
  onClose: () => void
  onChanged: (o: Organization) => void
}) {
  const { data, loading, error, reload } = useApi(
    (signal) => (id ? api.organization(id, signal) : Promise.resolve(null)),
    [id],
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const org = data ?? null
  const owners = (org?.members ?? []).filter((m) => m.role === 'OWNER').length

  async function setStatus(status: OrgStatus) {
    if (!org) return
    setBusy(status)
    setActionError(null)
    try {
      const updated = await api.updateOrganization(org.id, { status })
      onChanged(updated)
      reload()
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Could not change that')
    } finally {
      setBusy(null)
    }
  }

  const pill = org ? orgPill(org.status) : null

  return (
    <Modal
      open={id !== null}
      title={org?.name ?? 'Organization'}
      subtitle={org ? `${kindLabel(org.kind)} · ${org.slug}` : ''}
      onClose={onClose}
      size="wide"
    >
      {loading ? (
        <LoadingState label="Loading…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !org ? (
        <ErrorState message="Not found." />
      ) : (
        <div className="orgdetail">
          <div className="orgcol">
            <div className="orgblock">
              <span className="orgblock-t">Details</span>
              <DetailRow label="Status" value={<StatusPill variant={pill!.variant} label={pill!.label} />} />
              <DetailRow label="Address" value={org.address || '—'} />
              <DetailRow label="Phone" value={org.phone || '—'} />
              <DetailRow label="Email" value={org.email || '—'} />
              <DetailRow
                label="Payout"
                value={
                  org.bankMasked ? (
                    `${org.bankMasked}${org.bankName ? ` · ${org.bankName}` : ''}`
                  ) : (
                    <span className="orgwarn">Not set</span>
                  )
                }
              />
              <DetailRow label="Registered" value={formatDate(org.createdAt)} />
            </div>

            <div className="orgblock">
              <span className="orgblock-t">People</span>
              {(org.members ?? []).length === 0 ? (
                <p className="orgwarn" style={{ margin: 0 }}>
                  Nobody can act for this organization yet. Add an owner before approving it.
                </p>
              ) : (
                (org.members ?? []).map((m) => (
                  <div key={m.id} className="orgmember">
                    <div>
                      <b>{m.name ?? m.email ?? 'Member'}</b>
                      {m.email ? <span className="orgslug">{m.email}</span> : null}
                    </div>
                    <Badge variant="outline" className="tier">
                      {m.role === 'OWNER' ? 'Owner' : 'Staff'}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="orgaside">
            {/* Above Approval on purpose: a reviewer should have seen whether
                the business is who it says it is before deciding whether it can
                trade - even though nothing forces them to. */}
            {org.kind === 'STORE' && (
              <CacBlock org={org} canReview={canReview} onChanged={onChanged} onDone={reload} />
            )}

            {/* The premises audit, beside the decision it informs. The server
                has sent the latest finding with the record all along; this is
                the first screen to show it. */}
            {org.kind === 'STORE' && (
              <div className="orgblock">
                <span className="orgblock-t">Premises audit</span>
                {org.latestAudit ? (
                  <>
                    <DetailRow
                      label="Latest"
                      value={
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <b>{org.latestAudit.score}</b>
                          <StatusPill
                            variant={auditPill(org.latestAudit.outcome).variant}
                            label={auditPill(org.latestAudit.outcome).label}
                          />
                        </span>
                      }
                    />
                    <DetailRow label="Auditor" value={org.latestAudit.auditorName ?? 'Recorded by staff'} />
                    <DetailRow label="Filed" value={formatDate(org.latestAudit.createdAt)} />
                    {org.latestAudit.notes ? <p className="orgnote">{org.latestAudit.notes}</p> : null}
                    <p className="orgnote small">
                      <Link to="/audits">Every audit, with photos and signatures</Link>
                    </p>
                  </>
                ) : (
                  <p className="orgnote">Not audited yet.</p>
                )}
              </div>
            )}

            <div className="orgblock">
              <span className="orgblock-t">Approval</span>
              {org.status === 'PENDING' ? (
                <p className="orgnote">
                  This organization cannot receive orders or be paid until you approve it.
                </p>
              ) : org.status === 'ACTIVE' ? (
                <p className="orgnote">Live. It can receive orders and be paid.</p>
              ) : (
                <p className="orgnote">
                  Suspended. It keeps its data and its people, but receives nothing.
                </p>
              )}

              {/* Approving with no owner produces a live business nobody can
                  manage - which is a support ticket, not an edge case. */}
              {org.status !== 'ACTIVE' && owners === 0 ? (
                <div className="login-error" role="status" style={{ marginBottom: 12 }}>
                  <Icon name="alert" size={15} />
                  Add an owner first.
                </div>
              ) : null}

              {actionError && (
                <div className="login-error" role="alert" style={{ marginBottom: 12 }}>
                  <Icon name="alert" size={15} />
                  {actionError}
                </div>
              )}

              <div className="orgactions">
                {org.status !== 'ACTIVE' && (
                  <Button
                    variant="primary"
                    icon="check"
                    loading={busy === 'ACTIVE'}
                    disabled={!canEdit || owners === 0}
                    onClick={() => setStatus('ACTIVE')}
                  >
                    Approve
                  </Button>
                )}
                {org.status === 'ACTIVE' && (
                  <Button
                    variant="danger"
                    icon="x"
                    loading={busy === 'SUSPENDED'}
                    disabled={!canEdit}
                    onClick={() => setStatus('SUSPENDED')}
                  >
                    Suspend
                  </Button>
                )}
              </div>
              <p className="orgnote small">Recorded against your account either way.</p>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

const CAC_PILL: Record<CacStatus, { variant: 'pending' | 'ready' | 'danger' | 'review'; label: string }> = {
  UNVERIFIED: { variant: 'review', label: 'Not supplied' },
  PENDING: { variant: 'pending', label: 'Awaiting review' },
  VERIFIED: { variant: 'ready', label: 'Verified' },
  REJECTED: { variant: 'danger', label: 'Rejected' },
}

/**
 * CAC registration, as a reviewer sees it.
 *
 * The screen has to distinguish three things a single "unverified" would blur:
 * no number was ever supplied, a number is waiting for somebody, and a number
 * was checked and refused. Only the middle one is work.
 */
function CacBlock({
  org,
  canReview,
  onChanged,
  onDone,
}: {
  org: Organization
  canReview: boolean
  onChanged: (o: Organization) => void
  onDone: () => void
}) {
  const status: CacStatus = org.cacStatus ?? 'UNVERIFIED'
  const pill = CAC_PILL[status]
  const registry = useApi((signal) => api.cacConfig(signal))

  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function decide(decision: 'VERIFIED' | 'REJECTED') {
    setBusy(decision)
    setErr(null)
    try {
      const updated = await api.cacDecision(org.id, decision, note.trim() || undefined)
      onChanged(updated)
      onDone()
      setNote('')
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not record that')
    } finally {
      setBusy(null)
    }
  }

  // A name the registry returned that does not obviously match the trading name
  // is worth a reviewer's attention and is NOT evidence of anything on its own -
  // most Nigerian businesses trade under a shorter name than they registered.
  const mismatch =
    !!org.cacName && !looksLike(org.name, org.cacName)

  return (
    <div className="orgblock">
      <span className="orgblock-t">CAC registration</span>

      <DetailRow label="Status" value={<StatusPill variant={pill.variant} label={pill.label} />} />
      <DetailRow
        label="Number"
        value={org.cacNumber ? <span className="orgmono">{org.cacNumber}</span> : <span className="orgwarn">Not supplied</span>}
      />
      {org.cacName && <DetailRow label="Registered as" value={org.cacName} />}
      {org.cacCheckedAt && <DetailRow label="Last checked" value={formatDate(org.cacCheckedAt)} />}

      {org.cacNote && <p className="orgnote">{org.cacNote}</p>}

      {mismatch && (
        <div className="login-error" role="status" style={{ marginBottom: 12 }}>
          <Icon name="alert" size={15} />
          The registered name differs from the trading name. Common, and worth a look.
        </div>
      )}

      {/* Without this line, a reviewer reads a missing registered name as the
          registry having no record - when in fact nobody asked it. */}
      {registry.data && !registry.data.configured && status !== 'UNVERIFIED' && (
        <p className="orgnote small">
          No registry provider is configured, so this is a manual check against CAC yourself.
        </p>
      )}

      {status === 'UNVERIFIED' ? (
        <p className="orgnote small">
          The business supplies this itself, from its own dashboard. It does not stop the store
          being approved.
        </p>
      ) : (
        <>
          {err && (
            <div className="login-error" role="alert" style={{ marginBottom: 12 }}>
              <Icon name="alert" size={15} />
              {err}
            </div>
          )}
          <Label htmlFor="cac-note">Note</Label>
          <Textarea
            id="cac-note"
            rows={2}
            value={note}
            disabled={!canReview}
            placeholder="Required when rejecting"
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="orgactions" style={{ marginTop: 10 }}>
            <Button
              variant="primary"
              icon="check"
              loading={busy === 'VERIFIED'}
              disabled={!canReview || status === 'VERIFIED'}
              onClick={() => decide('VERIFIED')}
            >
              Confirm
            </Button>
            <Button
              variant="danger"
              icon="x"
              loading={busy === 'REJECTED'}
              disabled={!canReview || !note.trim()}
              onClick={() => decide('REJECTED')}
            >
              Reject
            </Button>
          </div>
          {!note.trim() && status !== 'REJECTED' && (
            <p className="orgnote small">A rejection needs a reason, so the business can fix it.</p>
          )}
        </>
      )}
    </div>
  )
}

/** Same loose comparison the server uses, for the warning only. */
function looksLike(trading: string, registered: string): boolean {
  const strip = (v: string) =>
    v
      .toUpperCase()
      .replace(/\b(LIMITED|LTD|PLC|ENTERPRISES|ENTERPRISE|NIG|NIGERIA|COMPANY|CO|AND|&)\b/g, '')
      .replace(/[^A-Z0-9]/g, '')
  const a = strip(trading)
  const b = strip(registered)
  if (!a || !b) return false
  return a.includes(b) || b.includes(a)
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="orgrow">
      <span className="orgrow-l">{label}</span>
      <span className="orgrow-v">{value}</span>
    </div>
  )
}
