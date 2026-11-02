import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { api, ApiError } from '../api/client'
import { useApi } from '../lib/useApi'
import { TIER_LABELS } from '../lib/format'
import { useAuth } from '../auth/AuthContext'
import { getAfrizoneIdentityToken } from '../lib/afrizone'
import type {
  Category,
  Funding,
  PayModel,
  TaxRate,
  Template,
  Tier,
  TwoFactorSetup,
  Skill,
  CredentialType,
} from '../api/types'
import { formatNaira, formatDate, formatDateTime } from '../lib/format'
import PageHeader from '../components/PageHeader'
import Glass from '../components/ui/Glass'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import OtpInput from '../components/ui/OtpInput'
import Icon from '../components/Icon'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateView'
import StatusPill from '../components/ui/StatusPill'
import './Settings.css'
import Input from '../components/ui/Input'
import Textarea from '../components/ui/Textarea'
import Select from '../components/ui/Select'
import Switch from '../components/ui/Switch'
import { Label } from '@/components/shadcn/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/shadcn/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/shadcn/table'

const TIERS: Tier[] = ['STUDENT', 'DISPATCH', 'REMOTE', 'PROMO', 'TRADE']
type Tab = 'tax' | 'categories' | 'skills' | 'credentialTypes' | 'requirements' | 'referrals' | 'templates' | 'billing' | 'security'


/* ===================== Tax Rates ===================== */

interface RateForm {
  jurisdiction: string
  category: string
  whtRate: string
  vatRate: string
}
const EMPTY_RATE: RateForm = { jurisdiction: '', category: 'default', whtRate: '5', vatRate: '0' }

function AddRateModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (r: TaxRate) => void
}) {
  const [form, setForm] = useState<RateForm>(EMPTY_RATE)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const created = await api.createTaxRate({
        jurisdiction: form.jurisdiction.trim(),
        category: form.category.trim() || 'default',
        whtRate: (Number(form.whtRate) || 0) / 100,
        vatRate: (Number(form.vatRate) || 0) / 100,
        active: true,
      })
      onCreated(created)
      setForm(EMPTY_RATE)
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add rate')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} title="Add tax rate" subtitle="WHT and VAT by jurisdiction" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="formgrid">
          <div className="field">
            <Label htmlFor="r-jur">Jurisdiction</Label>
            <Input
              id="r-jur"
              value={form.jurisdiction}
              onChange={(e) => setForm((f) => ({ ...f, jurisdiction: e.target.value }))}
              placeholder="Federal"
              required
            />
          </div>
          <div className="field">
            <Label htmlFor="r-cat">Category</Label>
            <Input
              id="r-cat"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              placeholder="Services"
            />
          </div>
          <div className="field">
            <Label htmlFor="r-wht">WHT %</Label>
            <Input
              id="r-wht"
              className="tnum"
              type="number"
              min="0"
              step="0.1"
              value={form.whtRate}
              onChange={(e) => setForm((f) => ({ ...f, whtRate: e.target.value }))}
              required
            />
          </div>
          <div className="field">
            <Label htmlFor="r-vat">VAT %</Label>
            <Input
              id="r-vat"
              className="tnum"
              type="number"
              min="0"
              step="0.1"
              value={form.vatRate}
              onChange={(e) => setForm((f) => ({ ...f, vatRate: e.target.value }))}
              required
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
          <Button type="submit" variant="primary" icon="check" loading={submitting}>
            Add rate
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function TaxRatesTab({ canEdit }: { canEdit: boolean }) {
  const { data, loading, error, reload, setData } = useApi((signal) => api.taxRates(signal))
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const rates = useMemo(() => data ?? [], [data])

  async function patch(id: string, body: Partial<TaxRate>) {
    setBusy(id)
    setActionError(null)
    try {
      const updated = await api.patchTaxRate(id, body)
      setData((prev) => (prev ?? []).map((r) => (r.id === id ? { ...r, ...updated } : r)))
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Update failed')
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <LoadingState label="Loading tax rates…" />
  if (error) return <ErrorState message={error} onRetry={reload} />

  return (
    <>
      <div className="tabhead">
        <p className="tabhint">
          Withholding and VAT rates applied at source per jurisdiction and category.
        </p>
        {canEdit && (
          <Button variant="primary" size="sm" icon="plus" onClick={() => setModalOpen(true)}>
            Add rate
          </Button>
        )}
      </div>

      {actionError && (
        <div className="login-error" role="alert" style={{ marginBottom: 16 }}>
          <Icon name="alert" size={15} />
          {actionError}
        </div>
      )}

      {rates.length === 0 ? (
        <Glass>
          <EmptyState icon="percent" title="No tax rates" sub="Add a jurisdiction rate to start." />
        </Glass>
      ) : (
        <Glass className="tablewrap">
          <Table className="dt">
            <TableHeader>
              <TableRow>
                <TableHead>Jurisdiction</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>WHT %</TableHead>
                <TableHead>VAT %</TableHead>
                <TableHead>Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.map((r) => (
                <TableRow key={r.id}>
                  <TableCell style={{ fontWeight: 600 }}>{r.jurisdiction}</TableCell>
                  <TableCell>{r.category}</TableCell>
                  <TableCell>
                    <Input
                      className="tnum cell"
                      type="number"
                      min="0"
                      step="0.1"
                      disabled={!canEdit || busy === r.id}
                      defaultValue={(r.whtRate * 100).toString()}
                      onBlur={(e) => {
                        const v = (Number(e.target.value) || 0) / 100
                        if (v !== r.whtRate) patch(r.id, { whtRate: v })
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="tnum cell"
                      type="number"
                      min="0"
                      step="0.1"
                      disabled={!canEdit || busy === r.id}
                      defaultValue={(r.vatRate * 100).toString()}
                      onBlur={(e) => {
                        const v = (Number(e.target.value) || 0) / 100
                        if (v !== r.vatRate) patch(r.id, { vatRate: v })
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={r.active}
                      disabled={!canEdit || busy === r.id}
                      label={`Toggle ${r.jurisdiction} ${r.category} active`}
                      onChange={(v) => patch(r.id, { active: v })}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Glass>
      )}

      <AddRateModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(r) => setData((prev) => [...(prev ?? []), r])}
      />
    </>
  )
}

/* ===================== Categories ===================== */

interface CatForm {
  name: string
  tier: Tier
  defaultPayModel: PayModel
}
const EMPTY_CAT: CatForm = { name: '', tier: 'DISPATCH', defaultPayModel: 'HOURLY' }

function AddCategoryModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (c: Category) => void
}) {
  const [form, setForm] = useState<CatForm>(EMPTY_CAT)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const created = await api.createCategory({
        name: form.name.trim(),
        tier: form.tier,
        defaultPayModel: form.defaultPayModel,
        active: true,
      })
      onCreated(created)
      setForm(EMPTY_CAT)
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add category')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} title="Add category" subtitle="Task category defaults" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="formgrid">
          <div className="field span2">
            <Label htmlFor="c-name">Name</Label>
            <Input
              id="c-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Dispatch"
              required
            />
          </div>
          <div className="field">
            <Label htmlFor="c-tier">Tier</Label>
            <Select
              id="c-tier"
              value={form.tier}
              onChange={(v) => setForm((f) => ({ ...f, tier: v as Tier }))}
              options={TIERS.map((t) => ({ value: t, label: TIER_LABELS[t] }))}
            />
          </div>
          <div className="field">
            <Label htmlFor="c-pm">Default pay model</Label>
            <Select
              id="c-pm"
              value={form.defaultPayModel}
              onChange={(v) => setForm((f) => ({ ...f, defaultPayModel: v as PayModel }))}
              options={[
                { value: 'HOURLY', label: 'Hourly' },
                { value: 'FIXED', label: 'Fixed' },
              ]}
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
          <Button type="submit" variant="primary" icon="check" loading={submitting}>
            Add category
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function CategoriesTab({ canEdit }: { canEdit: boolean }) {
  const { data, loading, error, reload, setData } = useApi((signal) => api.categories(signal))
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const cats = useMemo(() => data ?? [], [data])

  async function toggleActive(c: Category, active: boolean) {
    setBusy(c.id)
    setActionError(null)
    try {
      const updated = await api.patchCategory(c.id, { active })
      setData((prev) => (prev ?? []).map((x) => (x.id === c.id ? { ...x, ...updated } : x)))
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Update failed')
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <LoadingState label="Loading categories…" />
  if (error) return <ErrorState message={error} onRetry={reload} />

  return (
    <>
      <div className="tabhead">
        <p className="tabhint">Task categories with their default tier and pay model.</p>
        {canEdit && (
          <Button variant="primary" size="sm" icon="plus" onClick={() => setModalOpen(true)}>
            Add category
          </Button>
        )}
      </div>

      {actionError && (
        <div className="login-error" role="alert" style={{ marginBottom: 16 }}>
          <Icon name="alert" size={15} />
          {actionError}
        </div>
      )}

      {cats.length === 0 ? (
        <Glass>
          <EmptyState icon="tag" title="No categories" sub="Add a category to configure defaults." />
        </Glass>
      ) : (
        <Glass className="tablewrap">
          <Table className="dt">
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Default pay model</TableHead>
                <TableHead>Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cats.map((c) => (
                <TableRow key={c.id}>
                  <TableCell style={{ fontWeight: 600 }}>{c.name}</TableCell>
                  <TableCell>{TIER_LABELS[c.tier] ?? c.tier}</TableCell>
                  <TableCell>{c.defaultPayModel === 'HOURLY' ? 'Hourly' : 'Fixed'}</TableCell>
                  <TableCell>
                    <Switch
                      checked={c.active}
                      disabled={!canEdit || busy === c.id}
                      label={`Toggle ${c.name} active`}
                      onChange={(v) => toggleActive(c, v)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Glass>
      )}

      <AddCategoryModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(c) => setData((prev) => [...(prev ?? []), c])}
      />
    </>
  )
}

/* ===================== Templates ===================== */

function TemplateCard({
  tpl,
  canEdit,
  onSaved,
}: {
  tpl: Template
  canEdit: boolean
  onSaved: (t: Template) => void
}) {
  const [value, setValue] = useState(tpl.value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = value !== tpl.value

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const updated = await api.putTemplate(tpl.key, value)
      onSaved(updated)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Glass reveal style={{ padding: 18 }}>
      <div className="card-h" style={{ marginBottom: 12 }}>
        <div>
          <h3 style={{ fontSize: 15 }}>
            <Icon name="mail" size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
            {tpl.key}
          </h3>
        </div>
        {canEdit && (
          <Button
            variant="money"
            size="sm"
            icon="check"
            loading={saving}
            disabled={!dirty}
            onClick={save}
          >
            Save
          </Button>
        )}
      </div>
      <Textarea
        value={value}
        disabled={!canEdit}
        onChange={(e) => setValue(e.target.value)}
        aria-label={`Template ${tpl.key}`}
      />
      {error && (
        <div className="login-error" role="alert" style={{ marginTop: 12 }}>
          <Icon name="alert" size={15} />
          {error}
        </div>
      )}
    </Glass>
  )
}

/* ===================== Requirements gate ===================== */

const ENFORCE_KEY = 'eligibility.enforce'
/**
 * MART_INTEGRATION.md §6 D4. Off falls delivery back to what the platform did
 * before self-claim existed - an admin approving an application - rather than
 * leaving orders unassignable. It sits beside the requirements gate because
 * both answer the same question, "how does work get assigned right now", and
 * the moment either is needed is the worst moment to be hunting for it.
 */
const SELF_CLAIM_KEY = 'rules.DELIVERY.selfClaim'

/**
 * The one switch that turns the requirements gate off without a deploy.
 *
 * It lives on a screen rather than in a curl command because the moment it is
 * needed is the worst moment to be looking up an endpoint: something has gone
 * wrong in the pilot, workers cannot apply, and the fix has to be one click by
 * whoever is awake.
 *
 * Off is a real state with a real cost, so the screen says so plainly rather
 * than leaving a quiet toggle nobody remembers flipping.
 */
function RequirementsTab({ canEdit }: { canEdit: boolean }) {
  const { data, loading, error, reload, setData } = useApi((signal) => api.templates(signal))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Absent means ON for both of these. The server defaults the same way, and
  // the two must agree: a screen reading "off" for a gate the server is
  // enforcing would be worse than no screen at all.
  const isOn = (key: string) => {
    const row = (data ?? []).find((t) => t.key === key)
    return row ? String(row.value).toLowerCase() !== 'off' : true
  }
  const enforcing = isOn(ENFORCE_KEY)
  const selfClaim = isOn(SELF_CLAIM_KEY)

  async function setSwitch(key: string, next: boolean) {
    setSaving(true)
    setSaveError(null)
    try {
      const saved = await api.putTemplate(key, next ? 'on' : 'off')
      setData((prev) => {
        const list = prev ?? []
        return list.some((t) => t.key === key)
          ? list.map((t) => (t.key === key ? saved : t))
          : [...list, saved]
      })
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : 'Could not change the setting')
    } finally {
      setSaving(false)
    }
  }

  const setEnforcing = (next: boolean) => setSwitch(ENFORCE_KEY, next)

  if (loading) return <LoadingState label="Loading…" />
  if (error) return <ErrorState message={error} onRetry={reload} />

  return (
    <>
      <div className="tabhead">
        <p className="tabhint">
          Whether the requirements on a task actually stop a worker applying.
        </p>
      </div>
      <Glass>
        <div className="gate-row">
          <div>
            <b>Enforce task requirements</b>
            <span>
              On: a worker who does not meet a task&rsquo;s requirements cannot apply, and is
              shown what is missing. Off: they still see what a task asks for, but nothing
              blocks them.
            </span>
          </div>
          <Switch
            checked={enforcing}
            onChange={setEnforcing}
            disabled={!canEdit || saving}
            label="Enforce task requirements"
          />
        </div>
        {!enforcing && (
          <div className="login-error" role="status" style={{ marginTop: 14 }}>
            <Icon name="alert" size={15} />
            Requirements are not being enforced. Anyone in the right tier can apply to any
            task, including ones needing a confirmed ID or a checked document.
          </div>
        )}
        {saveError && (
          <div className="login-error" role="alert" style={{ marginTop: 14 }}>
            <Icon name="alert" size={15} />
            {saveError}
          </div>
        )}
        <p className="gate-note">
          Tier is always enforced, on or off. It is an older rule than this switch, and
          turning the gate down must not quietly delete it.
        </p>
      </Glass>

      <Glass style={{ marginTop: 16 }}>
        <div className="gate-row">
          <div>
            <b>Let couriers take deliveries themselves</b>
            <span>
              On: a qualified courier near the shop takes an order straight from their app,
              and the circle it is offered in widens as it waits. Off: every delivery waits
              for somebody to approve an application, which is how all other work is
              assigned.
            </span>
          </div>
          <Switch
            checked={selfClaim}
            onChange={(next) => setSwitch(SELF_CLAIM_KEY, next)}
            disabled={!canEdit || saving}
            label="Let couriers take deliveries themselves"
          />
        </div>
        {!selfClaim && (
          <div className="login-error" role="status" style={{ marginTop: 14 }}>
            <Icon name="alert" size={15} />
            Couriers cannot take deliveries. Every order will sit on the board until somebody
            approves an application for it, and an order that has to move within the hour will
            not.
          </div>
        )}
        <p className="gate-note">
          The radius, how fast it widens and when an unclaimed order is flagged for a person
          are the other <code>rules.DELIVERY</code> settings. They are numbers rather than
          switches, so they are edited on the Mart rules screen.
        </p>
      </Glass>
    </>
  )
}

function TemplatesTab({ canEdit }: { canEdit: boolean }) {
  const { data, loading, error, reload, setData } = useApi((signal) => api.templates(signal))
  const templates = useMemo(() => data ?? [], [data])

  if (loading) return <LoadingState label="Loading templates…" />
  if (error) return <ErrorState message={error} onRetry={reload} />

  return (
    <>
      <div className="tabhead">
        <p className="tabhint">
          Notification and contract templates. Use placeholders like <code>{'{{name}}'}</code>.
        </p>
      </div>
      {templates.length === 0 ? (
        <Glass>
          <EmptyState icon="mail" title="No templates" sub="Templates appear here once configured." />
        </Glass>
      ) : (
        <div className="tpl-grid">
          {templates.map((t) => (
            <TemplateCard
              key={t.key}
              tpl={t}
              canEdit={canEdit}
              onSaved={(u) =>
                setData((prev) => (prev ?? []).map((x) => (x.key === u.key ? u : x)))
              }
            />
          ))}
        </div>
      )}
    </>
  )
}

/* ===================== Security (2FA) ===================== */

function EnableTwoFactorModal({
  open,
  onClose,
  onEnabled,
}: {
  open: boolean
  onClose: () => void
  onEnabled: () => void
}) {
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null)
  const [loading, setLoading] = useState(false)
  const [code, setCode] = useState('')
  const [enabling, setEnabling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Call /2fa/setup once each time the modal opens (stores a pending secret).
  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setError(null)
    setSetup(null)
    setCode('')
    api
      .twoFactorSetup()
      .then((s) => {
        if (active) setSetup(s)
      })
      .catch((err) => {
        if (active)
          setError(err instanceof ApiError ? err.message : 'Could not start 2FA setup')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [open])

  function close() {
    setSetup(null)
    setCode('')
    setError(null)
    onClose()
  }

  async function enable(value: string) {
    if (enabling) return
    setError(null)
    setEnabling(true)
    try {
      await api.twoFactorEnable(value)
      onEnabled()
      close()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invalid code')
      setCode('')
    } finally {
      setEnabling(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Enable two-factor"
      subtitle="Scan the QR code in your authenticator app"
      onClose={close}
    >
      {loading ? (
        <LoadingState label="Preparing your secret…" />
      ) : error && !setup ? (
        <ErrorState message={error} />
      ) : setup ? (
        <div className="twofa-setup">
          <div className="twofa-qr">
            <img src={setup.qrDataUrl} alt="Two-factor QR code" width={176} height={176} />
          </div>
          <p className="tabhint">
            Can’t scan? Enter this secret manually:
          </p>
          <code className="twofa-secret">{setup.secret}</code>
          <p className="tabhint" style={{ marginTop: 10 }}>
            Then enter the 6-digit code shown in your app to confirm.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (code.length === 6) enable(code)
            }}
            style={{ marginTop: 12 }}
          >
            <OtpInput
              value={code}
              onChange={setCode}
              onComplete={enable}
              disabled={enabling}
              ariaLabel="Confirmation code"
            />
            {error && (
              <div className="login-error" role="alert" style={{ marginTop: 16 }}>
                <Icon name="alert" size={15} />
                {error}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <Button type="button" variant="glass" onClick={close}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                icon="shield"
                loading={enabling}
                disabled={code.length !== 6}
              >
                Confirm &amp; enable
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </Modal>
  )
}

function DisableTwoFactorModal({
  open,
  onClose,
  onDisabled,
}: {
  open: boolean
  onClose: () => void
  onDisabled: () => void
}) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function close() {
    setCode('')
    setError(null)
    onClose()
  }

  async function disable(value: string) {
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      await api.twoFactorDisable(value)
      onDisabled()
      close()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invalid code')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Disable two-factor"
      subtitle="Enter a current code to turn off 2FA"
      onClose={close}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (code.length === 6) disable(code)
        }}
      >
        <p className="tabhint" style={{ marginBottom: 14 }}>
          This removes the extra sign-in step. Enter a 6-digit code from your
          authenticator to confirm.
        </p>
        <OtpInput
          value={code}
          onChange={setCode}
          onComplete={disable}
          disabled={busy}
          ariaLabel="Disable confirmation code"
        />
        {error && (
          <div className="login-error" role="alert" style={{ marginTop: 16 }}>
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <Button type="button" variant="glass" onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="danger"
            icon="lock"
            loading={busy}
            disabled={code.length !== 6}
          >
            Disable 2FA
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/* ===================== Billing / Funding ===================== */

function fundingPill(s: Funding['status']): { variant: 'pending' | 'ready' | 'danger'; label: string } {
  switch (s) {
    case 'SUCCESS':
      return { variant: 'ready', label: 'Success' }
    case 'FAILED':
      return { variant: 'danger', label: 'Failed' }
    default:
      return { variant: 'pending', label: 'Pending' }
  }
}

function FundingModal({
  open,
  onClose,
  onInitialized,
}: {
  open: boolean
  onClose: () => void
  onInitialized: (f: Funding) => void
}) {
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const amt = Math.round(Number(amount))
    if (!Number.isInteger(amt) || amt <= 0) {
      setError('Enter a whole-Naira amount greater than 0')
      return
    }
    setSubmitting(true)
    try {
      const funding = await api.initializeFunding(amt)
      onInitialized(funding)
      setAmount('')
      onClose()
      if (funding.authorizationUrl) {
        window.location.href = funding.authorizationUrl
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start funding')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} title="Fund platform wallet" subtitle="Top up the balance that worker withdrawals draw from" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="formgrid">
          <div className="field">
            <Label htmlFor="fund-amt">Amount (₦)</Label>
            <Input
              id="fund-amt"
              type="number"
              min="1"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="500000"
              required
              autoFocus
            />
          </div>
        </div>
        {error && (
          <div className="login-error" role="alert" style={{ marginTop: 4 }}>
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}
        <div className="modal-actions">
          <Button type="button" variant="glass" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon="naira" loading={submitting}>
            Continue to pay
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function BillingTab({ canEdit }: { canEdit: boolean }) {
  const balanceRes = useApi((signal) => api.fundingBalance(signal))
  const historyRes = useApi((signal) => api.fundingHistory(signal))
  const configRes = useApi((signal) => api.healthConfig(signal))
  const [modalOpen, setModalOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [settling, setSettling] = useState(false)
  const history = useMemo(() => historyRes.data ?? [], [historyRes.data])
  const simulated = configRes.data ? !configRes.data.services.paystack.ok : false

  function refreshAll() {
    balanceRes.reload()
    historyRes.reload()
  }

  async function devSettle() {
    setSettling(true)
    setActionError(null)
    try {
      await api.devSettleFunding()
      refreshAll()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Settlement failed')
    } finally {
      setSettling(false)
    }
  }

  if (balanceRes.loading || historyRes.loading) return <LoadingState label="Loading billing…" />
  if (balanceRes.error) return <ErrorState message={balanceRes.error} onRetry={refreshAll} />

  return (
    <>
      <div className="tabhead">
        <p className="tabhint">
          Fund the platform wallet via Paystack so worker withdrawals have a balance to draw from.
        </p>
        {canEdit && (
          <Button variant="primary" size="sm" icon="naira" onClick={() => setModalOpen(true)}>
            Fund wallet
          </Button>
        )}
      </div>

      {actionError && (
        <div className="login-error" role="alert" style={{ marginBottom: 16 }}>
          <Icon name="alert" size={15} />
          {actionError}
        </div>
      )}

      <Glass reveal style={{ padding: 20, marginBottom: 16 }}>
        <div className="card-h" style={{ alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <span className="twofa-ic" style={{ color: 'var(--money)' }}>
              <Icon name="naira" size={22} />
            </span>
            <div>
              <h3 style={{ fontSize: 16 }}>Platform balance</h3>
              <p className="tabhint" style={{ marginTop: 4 }}>
                {formatNaira(balanceRes.data?.balance ?? 0)}
              </p>
              {simulated && (
                <span className="twofa-status">
                  <span className="dot" />
                  Simulated mode: set PAYSTACK_SECRET for live charges
                </span>
              )}
            </div>
          </div>
          {canEdit && simulated && (
            <Button variant="glass" size="sm" loading={settling} onClick={devSettle}>
              Simulate payment received
            </Button>
          )}
        </div>
      </Glass>

      {history.length === 0 ? (
        <Glass>
          <EmptyState icon="naira" title="No funding yet" sub="Fund the platform wallet to get started." />
        </Glass>
      ) : (
        <Glass className="tablewrap">
          <Table className="dt">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Initiated by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((f) => {
                const pill = fundingPill(f.status)
                return (
                  <TableRow key={f.id}>
                    <TableCell>{formatDate(f.createdAt)}</TableCell>
                    <TableCell style={{ fontWeight: 600 }}>{formatNaira(f.amount)}</TableCell>
                    <TableCell>
                      <StatusPill variant={pill.variant} label={pill.label} />
                    </TableCell>
                    <TableCell>{f.admin?.name ?? '—'}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Glass>
      )}

      <FundingModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onInitialized={() => refreshAll()}
      />
    </>
  )
}

/**
 * Link this staff account to an AfriZone account. The portal's "Continue with
 * AfriZone" refuses staff emails on purpose (it would hand a staff session to
 * whoever controls the AfriZone account), so staff link here instead: being
 * signed in to both at once is the proof of owning both.
 *
 * No unlink: the server has none yet. Ask an engineer if one is ever needed.
 */
function AfrizoneLinkCard() {
  const { user, refreshUser } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const linked = !!user?.afrizoneUserId

  // Not async: the popup must open in the click's own tick or it is blocked.
  function link() {
    setBusy(true)
    setError(null)
    getAfrizoneIdentityToken()
      .then((t) => api.afrizoneLink(t))
      .then(() => refreshUser())
      .catch((err) =>
        setError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not link your account.'),
      )
      .finally(() => setBusy(false))
  }

  return (
    <Glass reveal style={{ padding: 20, marginTop: 16 }}>
      <div className="card-h" style={{ marginBottom: 14, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <span className="twofa-ic" style={{ color: linked ? 'var(--money)' : 'var(--gold)' }}>
            <Icon name="users" size={22} />
          </span>
          <div>
            <h3 style={{ fontSize: 16 }}>AfriZone account</h3>
            <p className="tabhint" style={{ marginTop: 4 }}>
              Link the account you use on afrizonemart.com. You will be asked to sign in to
              AfriZone in a pop-up if you are not already.
            </p>
            <span className={`twofa-status ${linked ? 'on' : ''}`}>
              <span className="dot" />
              {linked ? 'Linked' : 'Not linked'}
            </span>
          </div>
        </div>
      </div>
      {error && (
        <div className="login-error" role="alert" style={{ marginBottom: 14 }}>
          <Icon name="alert" size={15} />
          <span>{error}</span>
        </div>
      )}
      {!linked && (
        <Button variant="primary" icon="key" onClick={link} disabled={busy}>
          {busy ? 'Waiting for AfriZone…' : 'Link AfriZone account'}
        </Button>
      )}
    </Glass>
  )
}

function SecurityTab() {
  const { user, refreshUser } = useAuth()
  const [enableOpen, setEnableOpen] = useState(false)
  const [disableOpen, setDisableOpen] = useState(false)
  const enabled = !!user?.totpEnabled

  return (
    <>
      <div className="tabhead">
        <p className="tabhint">
          Protect your admin account with an extra step at sign-in.
        </p>
      </div>

      <Glass reveal style={{ padding: 20 }}>
        <div className="card-h" style={{ marginBottom: 14, alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <span
              className="twofa-ic"
              style={{ color: enabled ? 'var(--money)' : 'var(--gold)' }}
            >
              <Icon name="shield" size={22} />
            </span>
            <div>
              <h3 style={{ fontSize: 16 }}>Two-factor authentication</h3>
              <p className="tabhint" style={{ marginTop: 4 }}>
                Time-based one-time codes (TOTP) from an authenticator app such as
                Google Authenticator or 1Password.
              </p>
              <span className={`twofa-status ${enabled ? 'on' : ''}`}>
                <span className="dot" />
                {enabled ? 'Enabled' : 'Not enabled'}
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          {enabled ? (
            <Button variant="danger" icon="lock" onClick={() => setDisableOpen(true)}>
              Disable 2FA
            </Button>
          ) : (
            <Button variant="primary" icon="shield" onClick={() => setEnableOpen(true)}>
              Enable 2FA
            </Button>
          )}
        </div>
      </Glass>

      <AfrizoneLinkCard />

      <EnableTwoFactorModal
        open={enableOpen}
        onClose={() => setEnableOpen(false)}
        onEnabled={() => void refreshUser()}
      />
      <DisableTwoFactorModal
        open={disableOpen}
        onClose={() => setDisableOpen(false)}
        onDisabled={() => void refreshUser()}
      />
    </>
  )
}

/* ===================== Skills ===================== */

/**
 * The skills catalogue.
 *
 * Worth stating on the page itself, because it is the thing everyone assumes
 * wrongly: a skill is the worker's own word and gates nothing. Only credentials
 * are checked by a person, and only credentials can unlock work. If something
 * here needs to be guaranteed, it belongs in the next tab instead.
 */
function SkillsTab({ canEdit }: { canEdit: boolean }) {
  const { data, loading, error, reload, setData } = useApi((signal) => api.skills(true, signal))
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [group, setGroup] = useState('')
  const skills = useMemo(() => data ?? [], [data])

  const groups = useMemo(() => {
    const seen = new Map<string, Skill[]>()
    for (const sk of skills) {
      const list = seen.get(sk.group) ?? []
      list.push(sk)
      seen.set(sk.group, list)
    }
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [skills])

  async function toggleActive(sk: Skill, active: boolean) {
    setBusy(sk.id)
    setActionError(null)
    try {
      const updated = await api.patchSkill(sk.id, { active })
      setData((prev) => (prev ?? []).map((x) => (x.id === sk.id ? { ...x, ...updated } : x)))
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Update failed')
    } finally {
      setBusy(null)
    }
  }

  async function create() {
    setBusy('new')
    setActionError(null)
    try {
      const made = await api.createSkill({ name: name.trim(), group: group.trim() })
      setData((prev) => [...(prev ?? []), made])
      setOpen(false)
      setName('')
      setGroup('')
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not add that skill')
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <LoadingState label="Loading skills…" />
  if (error) return <ErrorState message={error} onRetry={reload} />

  return (
    <>
      <div className="tabhead">
        <p className="tabhint">
          What workers can say they can do. Self-declared and never checked &mdash; use credential
          types for anything that has to be proven.
        </p>
        {canEdit && (
          <Button variant="primary" size="sm" icon="plus" onClick={() => setOpen(true)}>
            Add skill
          </Button>
        )}
      </div>

      {actionError && (
        <div className="login-error" role="alert" style={{ marginBottom: 16 }}>
          <Icon name="alert" size={15} />
          {actionError}
        </div>
      )}

      {skills.length === 0 ? (
        <Glass>
          <EmptyState icon="tag" title="No skills yet" sub="Add the first one to build the picker." />
        </Glass>
      ) : (
        <Glass className="tablewrap">
          <Table className="dt">
            <TableHeader>
              <TableRow>
                <TableHead>Skill</TableHead>
                <TableHead>Group</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Available</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map(([groupName, items]) =>
                items.map((sk) => (
                  <TableRow key={sk.id}>
                    <TableCell>{sk.name}</TableCell>
                    <TableCell style={{ color: 'var(--muted)' }}>{groupName}</TableCell>
                    <TableCell style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--muted)' }}>
                      {sk.slug}
                    </TableCell>
                    <TableCell>
                      {/* Retiring hides it from the picker but keeps it on the
                          workers who already declared it - retiring a catalogue
                          entry must not silently edit somebody's profile. */}
                      <Switch
                        checked={sk.active}
                        disabled={!canEdit || busy === sk.id}
                        label={`${sk.name} available`}
                        onChange={(v) => toggleActive(sk, v)}
                      />
                    </TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
        </Glass>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add a skill">
        <div className="field">
          <label htmlFor="sk-name">Name</label>
          <Input id="sk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Forklift operation" />
        </div>
        <div className="field">
          <label htmlFor="sk-group">Group</label>
          <Input id="sk-group" value={group} onChange={(e) => setGroup(e.target.value)} placeholder="Logistics" />
          <span className="help">How the picker groups it in the worker app.</span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button
            variant="primary"
            loading={busy === 'new'}
            disabled={!name.trim() || !group.trim()}
            onClick={create}
          >
            Add skill
          </Button>
          <Button variant="glass" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </Modal>
    </>
  )
}

/* ===================== Credential types ===================== */

/**
 * What Afrizone recognises as a checkable credential, and what each one
 * demands from the worker. These are the things that can actually gate work,
 * because a person looks at the document before it counts.
 */
function CredentialTypesTab({ canEdit }: { canEdit: boolean }) {
  const { data, loading, error, reload, setData } = useApi((signal) => api.credentialTypes(true, signal))
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [issuerMode, setIssuerMode] = useState<'THIRD_PARTY' | 'AFRIZONE'>('THIRD_PARTY')
  const [reviewMode, setReviewMode] = useState<'ADMIN_REVIEW' | 'SELF_DECLARED'>('ADMIN_REVIEW')
  const [requiresExpiry, setRequiresExpiry] = useState(false)
  const [requiresReference, setRequiresReference] = useState(false)
  const [issuerHint, setIssuerHint] = useState('')
  const types = useMemo(() => data ?? [], [data])

  async function toggleActive(t: CredentialType, active: boolean) {
    setBusy(t.id)
    setActionError(null)
    try {
      const updated = await api.patchCredentialType(t.id, { active })
      setData((prev) => (prev ?? []).map((x) => (x.id === t.id ? { ...x, ...updated } : x)))
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Update failed')
    } finally {
      setBusy(null)
    }
  }

  async function create() {
    setBusy('new')
    setActionError(null)
    try {
      const made = await api.createCredentialType({
        name: name.trim(),
        issuerMode,
        reviewMode,
        requiresExpiry,
        requiresReference,
        issuerHint: issuerHint.trim() || null,
      })
      setData((prev) => [...(prev ?? []), made])
      setOpen(false)
      setName('')
      setIssuerHint('')
      setRequiresExpiry(false)
      setRequiresReference(false)
      setIssuerMode('THIRD_PARTY')
      setReviewMode('ADMIN_REVIEW')
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not add that credential type')
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <LoadingState label="Loading credential types…" />
  if (error) return <ErrorState message={error} onRetry={reload} />

  return (
    <>
      <div className="tabhead">
        <p className="tabhint">
          The documents Afrizone checks. Only these can unlock work &mdash; a skill never does.
        </p>
        {canEdit && (
          <Button variant="primary" size="sm" icon="plus" onClick={() => setOpen(true)}>
            Add type
          </Button>
        )}
      </div>

      {actionError && (
        <div className="login-error" role="alert" style={{ marginBottom: 16 }}>
          <Icon name="alert" size={15} />
          {actionError}
        </div>
      )}

      {types.length === 0 ? (
        <Glass>
          <EmptyState icon="shield" title="No credential types" sub="Add one to start collecting documents." />
        </Glass>
      ) : (
        <Glass className="tablewrap">
          <Table className="dt">
            <TableHeader>
              <TableRow>
                <TableHead>Credential</TableHead>
                <TableHead>Issued by</TableHead>
                <TableHead>Checked</TableHead>
                <TableHead>Requires</TableHead>
                <TableHead>Available</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.map((t) => {
                const needs = [
                  t.requiresFile ? 'document' : null,
                  t.requiresExpiry ? 'expiry' : null,
                  t.requiresReference ? 'reference' : null,
                ].filter(Boolean)
                return (
                  <TableRow key={t.id}>
                    <TableCell>
                      {t.name}
                      <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--muted)' }}>
                        {t.slug}
                      </div>
                    </TableCell>
                    <TableCell style={{ color: 'var(--muted)' }}>
                      {t.issuerMode === 'AFRIZONE' ? 'Afrizone' : 'Third party'}
                    </TableCell>
                    <TableCell style={{ color: 'var(--muted)' }}>
                      {t.reviewMode === 'ADMIN_REVIEW' ? 'By an admin' : 'Not checked'}
                    </TableCell>
                    <TableCell style={{ color: 'var(--muted)', fontSize: 12 }}>
                      {needs.length ? needs.join(', ') : '—'}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={t.active}
                        disabled={!canEdit || busy === t.id}
                        label={`${t.name} available`}
                        onChange={(v) => toggleActive(t, v)}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Glass>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add a credential type">
        <div className="field">
          <label htmlFor="ct-name">Name</label>
          <Input id="ct-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Food handler permit" />
        </div>

        <div className="field">
          <label htmlFor="ct-issuer">Issued by</label>
          <select
            id="ct-issuer"
            className="select"
            value={issuerMode}
            onChange={(e) => setIssuerMode(e.target.value as 'THIRD_PARTY' | 'AFRIZONE')}
          >
            <option value="THIRD_PARTY">Somebody else (worker uploads their document)</option>
            <option value="AFRIZONE">Afrizone (awarded from work history, no document)</option>
          </select>
          <span className="help">
            {issuerMode === 'AFRIZONE'
              ? 'Awarded by an admin on the strength of work done here. This is how somebody with no formal certificate can still qualify.'
              : 'The worker submits it with evidence, and it goes to the review queue.'}
          </span>
        </div>

        <div className="field">
          <label htmlFor="ct-review">Checked by</label>
          <select
            id="ct-review"
            className="select"
            value={reviewMode}
            onChange={(e) => setReviewMode(e.target.value as 'ADMIN_REVIEW' | 'SELF_DECLARED')}
          >
            <option value="ADMIN_REVIEW">An admin reviews it</option>
            <option value="SELF_DECLARED">Nobody &mdash; recorded on the worker&apos;s word</option>
          </select>
          <span className="help">
            {reviewMode === 'SELF_DECLARED'
              ? 'Recorded but never verified, so it can never unlock work. Right for things like a CV.'
              : 'Goes into the verification queue and can unlock work once approved.'}
          </span>
        </div>

        {issuerMode === 'THIRD_PARTY' && (
          <>
            <div className="field">
              <label htmlFor="ct-hint">Issuer hint</label>
              <Input
                id="ct-hint"
                value={issuerHint}
                onChange={(e) => setIssuerHint(e.target.value)}
                placeholder="FRSC"
              />
              <span className="help">Shown to the worker as a placeholder.</span>
            </div>
            <div className="field" style={{ display: 'flex', gap: 16, flexDirection: 'row' }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={requiresExpiry}
                  onChange={(e) => setRequiresExpiry(e.target.checked)}
                />
                Has an expiry date
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={requiresReference}
                  onChange={(e) => setRequiresReference(e.target.checked)}
                />
                Has a reference number
              </label>
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button variant="primary" loading={busy === 'new'} disabled={!name.trim()} onClick={create}>
            Add type
          </Button>
          <Button variant="glass" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </Modal>
    </>
  )
}

/* ===================== Referrals ===================== */

/**
 * The referral loop (Blueprint §14, server services/referrals.ts).
 *
 * The two amounts are what a referrer earns when a Tasker they brought in is
 * paid for a first job, or a store they brought in is approved. Both start at
 * 0, which is off: every naira is Afrizone's. Below them, who has brought whom
 * in, so a ring of accounts referring each other is visible to a person.
 */
function ReferralsTab({ canEdit }: { canEdit: boolean }) {
  const { data, loading, error, reload } = useApi((signal) => api.referrals(signal))
  const [tasker, setTasker] = useState<string | null>(null)
  const [store, setStore] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (loading) return <LoadingState label="Loading referrals…" />
  if (error || !data) return <ErrorState message={error ?? 'Could not load referrals'} onRetry={reload} />

  const taskerValue = tasker ?? String(data.rewards.taskerReward || '')
  const storeValue = store ?? String(data.rewards.storeReward || '')
  const dirty =
    (tasker !== null && Number(tasker || 0) !== data.rewards.taskerReward) ||
    (store !== null && Number(store || 0) !== data.rewards.storeReward)

  async function save() {
    setBusy(true)
    setErr(null)
    try {
      const writes: Promise<unknown>[] = []
      if (tasker !== null) writes.push(api.putTemplate('referral.taskerReward', String(Number(tasker || 0))))
      if (store !== null) writes.push(api.putTemplate('referral.storeReward', String(Number(store || 0))))
      await Promise.all(writes)
      setTasker(null)
      setStore(null)
      reload()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  async function cancel(id: string) {
    setErr(null)
    try {
      await api.voidReferral(id)
      reload()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not cancel')
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Glass>
        <h3 style={{ fontSize: 15, margin: '0 0 6px' }}>Rewards</h3>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 14px' }}>
          Paid to the referrer only, into their wallet, less 5% WHT. Empty or 0 is off. A change applies to
          referrals that pay from now on; ones already paid keep their amount.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <div className="field">
            <Label htmlFor="ref-tasker">New Tasker, after their first paid job (₦)</Label>
            <Input
              id="ref-tasker"
              type="number"
              min={0}
              value={taskerValue}
              placeholder="Off"
              disabled={!canEdit}
              onChange={(e) => setTasker(e.target.value)}
            />
          </div>
          <div className="field">
            <Label htmlFor="ref-store">New store, once approved (₦)</Label>
            <Input
              id="ref-store"
              type="number"
              min={0}
              value={storeValue}
              placeholder="Off"
              disabled={!canEdit}
              onChange={(e) => setStore(e.target.value)}
            />
          </div>
        </div>
        {err && (
          <div className="login-error" role="alert" style={{ marginTop: 12 }}>
            {err}
          </div>
        )}
        {canEdit && dirty && (
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <Button size="sm" loading={busy} onClick={save}>
              Save
            </Button>
            <Button
              size="sm"
              variant="glass"
              onClick={() => {
                setTasker(null)
                setStore(null)
              }}
            >
              Cancel
            </Button>
          </div>
        )}
      </Glass>

      <Glass className="tablewrap">
        <div style={{ padding: '14px 16px 0', fontSize: 13, color: 'var(--muted)' }}>
          {data.referrals.length} referrals · {formatNaira(data.paidOut)} paid out before tax
        </div>
        {data.referrals.length === 0 ? (
          <EmptyState icon="users" title="No referrals yet" sub="They appear here once someone uses a code." />
        ) : (
          <Table className="dt">
            <TableHeader>
              <TableRow>
                <TableHead>Referred</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reward</TableHead>
                <TableHead>Since</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.referrals.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    {r.referred.name}
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.kind === 'STORE' ? 'Store' : 'Tasker'}</div>
                  </TableCell>
                  <TableCell>{r.referrer.name}</TableCell>
                  <TableCell>
                    <StatusPill
                      variant={r.status === 'EARNED' ? 'paid' : r.status === 'VOID' ? 'danger' : 'pending'}
                      label={r.status === 'EARNED' ? 'Paid' : r.status === 'VOID' ? 'Cancelled' : 'Waiting'}
                    />
                  </TableCell>
                  <TableCell className="tnum">{r.status === 'EARNED' ? formatNaira(r.gross) : '—'}</TableCell>
                  <TableCell>{formatDateTime(r.createdAt)}</TableCell>
                  <TableCell>
                    {canEdit && r.status === 'PENDING' && (
                      <Button size="sm" variant="glass" onClick={() => cancel(r.id)}>
                        Cancel
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Glass>
    </div>
  )
}

/* ===================== Page ===================== */

const TABS: { id: Tab; label: string; icon: 'percent' | 'tag' | 'mail' | 'naira' | 'shield' | 'lock' }[] = [
  { id: 'tax', label: 'Tax rates', icon: 'percent' },
  { id: 'categories', label: 'Categories', icon: 'tag' },
  { id: 'skills', label: 'Skills', icon: 'tag' },
  { id: 'credentialTypes', label: 'Credential types', icon: 'shield' },
  { id: 'requirements', label: 'Requirements', icon: 'lock' },
  { id: 'referrals', label: 'Referrals', icon: 'naira' },
  { id: 'templates', label: 'Templates', icon: 'mail' },
  { id: 'billing', label: 'Billing', icon: 'naira' },
  { id: 'security', label: 'Security', icon: 'shield' },
]

export default function Settings() {
  const { user } = useAuth()
  const hasBillingRef = useMemo(
    () => new URLSearchParams(window.location.search).has('billing_ref'),
    [],
  )
  const [tab, setTab] = useState<Tab>(hasBillingRef ? 'billing' : 'tax')
  const canEdit = user?.role === 'SUPER_ADMIN'

  return (
    <>
      <PageHeader
        crumb="Insights / Settings"
        title="Settings"
        sub={
          canEdit
            ? 'Tax rates, task categories and message templates'
            : 'Read-only · changes require Super Admin'
        }
      />

      {!canEdit && tab !== 'security' && (
        <div className="login-error" role="status" style={{ marginBottom: 16 }}>
          <Icon name="alert" size={15} />
          You are viewing settings in read-only mode. Editing requires the SUPER_ADMIN role.
        </div>
      )}

      {/* Radix supplies what the hand-rolled version claimed but did not do: the
          bar had role="tab" and aria-selected, yet no arrow-key navigation, no
          aria-controls linking a trigger to its panel, and the panels were not
          tabpanels at all. Panels stay unmounted until selected, so each tab
          still fetches only when opened. */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="tabs" aria-label="Settings sections">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="tab">
              <Icon name={t.icon} />
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="tax">
          <TaxRatesTab canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="categories">
          <CategoriesTab canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="skills">
          <SkillsTab canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="credentialTypes">
          <CredentialTypesTab canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="requirements">
          <RequirementsTab canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="referrals">
          <ReferralsTab canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="templates">
          <TemplatesTab canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="billing">
          <BillingTab canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="security">
          <SecurityTab />
        </TabsContent>
      </Tabs>
    </>
  )
}
