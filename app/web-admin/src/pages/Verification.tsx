/**
 * The credential review desk.
 *
 * This page is worked, not browsed. Somebody sits at it and makes the same
 * decision dozens of times, and every design choice here follows from that:
 *
 *  - the document and the fields are side by side, because the job is
 *    comparing one against the other, and a modal that hides either turns one
 *    decision into three clicks;
 *  - the fields are EDITABLE before approving, because the worker typed theirs
 *    on a phone and the reviewer is looking at the actual document;
 *  - rejection reasons are preset, because the text reaches the worker
 *    verbatim and a queue worked at speed produces curt, unusable messages;
 *  - there are keyboard shortcuts, because a queue worked fifty times a day
 *    will not be worked without them.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import './Verification.css'
import { api, ApiError } from '../api/client'
import { useApi } from '../lib/useApi'
import { avatarGradient, initials, kycPill } from '../lib/format'
import type { PillVariant } from '../lib/format'
import PageHeader from '../components/PageHeader'
import Glass from '../components/ui/Glass'
import Button from '../components/ui/Button'
import StatusPill from '../components/ui/StatusPill'
import Modal from '../components/ui/Modal'
import Icon from '../components/Icon'
import AuthedImage from '../components/ui/AuthedImage'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateView'
import Textarea from '../components/ui/Textarea'
import Input from '../components/ui/Input'
import { Label } from '@/components/shadcn/label'
import { Avatar, AvatarFallback } from '@/components/shadcn/avatar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/shadcn/table'
import type {
  Credential,
  CredentialCorrections,
  CredentialDetail,
  CredentialFilter,
  RejectionReasonCode,
} from '../api/types'

const FILTERS: { key: CredentialFilter; label: string }[] = [
  { key: 'pending', label: 'Awaiting review' },
  { key: 'expiring', label: 'Expiring soon' },
  { key: 'verified', label: 'Verified' },
  { key: 'rejected', label: 'Rejected' },
]

/**
 * Shown to the reviewer; the worker gets the server's fuller wording. Kept in
 * the same order as the server's list so the two read as one thing.
 */
const REASONS: { code: RejectionReasonCode; label: string }[] = [
  { code: 'blurry', label: 'Too blurry to read' },
  { code: 'expired', label: 'Document has expired' },
  { code: 'name_mismatch', label: 'Name does not match' },
  { code: 'wrong_type', label: 'Wrong document type' },
  { code: 'not_genuine', label: 'Could not confirm it is genuine' },
  { code: 'other', label: 'Something else…' },
]

function statePill(state: string): { variant: PillVariant; label: string } {
  switch (state) {
    case 'VERIFIED':
      return { variant: 'paid', label: 'Verified' }
    case 'PENDING':
      return { variant: 'review', label: 'Awaiting review' }
    case 'REJECTED':
      return { variant: 'danger', label: 'Rejected' }
    case 'REVOKED':
      return { variant: 'danger', label: 'Revoked' }
    // Not a failure and not a rejection, but it does not count any more -
    // which for the reviewer is the same practical situation.
    case 'EXPIRED':
      return { variant: 'danger', label: 'Expired' }
    // Recorded on the worker's word. Never dressed up as something checked.
    case 'SELF_DECLARED':
      return { variant: 'pending', label: 'Added by Partimer' }
    default:
      return { variant: 'pending', label: state }
  }
}

function fmtDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** ISO date-time → the yyyy-mm-dd a date input needs. */
function toDateInput(value: string | null): string {
  if (!value) return ''
  return new Date(value).toISOString().slice(0, 10)
}

export default function Verification() {
  const [filter, setFilter] = useState<CredentialFilter>('pending')
  const { data, loading, error, reload, setData } = useApi(
    (signal) => api.credentials(filter, signal),
    [filter],
  )
  const [openId, setOpenId] = useState<string | null>(null)
  const rows = useMemo(() => data ?? [], [data])

  /**
   * Move to the next item in the queue after a decision, rather than closing.
   * A reviewer with forty to get through should never have to re-open the list
   * between two of them.
   */
  const advance = useCallback(
    (decidedId: string) => {
      const idx = rows.findIndex((r) => r.id === decidedId)
      const next = rows[idx + 1]
      setData((prev) => (prev ?? []).filter((r) => r.id !== decidedId))
      setOpenId(next ? next.id : null)
    },
    [rows, setData],
  )

  return (
    <>
      <PageHeader
        crumb="Operations / Verification"
        title="Credential review"
        sub={loading ? 'Loading…' : `${rows.length} ${filter === 'pending' ? 'awaiting review' : 'shown'}`}
      />

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? 'primary' : 'glass'}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <LoadingState label="Loading credentials…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : rows.length === 0 ? (
        <Glass>
          <EmptyState
            icon="check-circle"
            title={filter === 'pending' ? 'Queue is clear' : 'Nothing here'}
            sub={
              filter === 'pending'
                ? 'Every credential submitted has been reviewed.'
                : 'No credentials match this filter right now.'
            }
          />
        </Glass>
      ) : (
        <Glass reveal delay="d1" className="tablewrap">
          <Table className="dt">
            <TableHeader>
              <TableRow>
                <TableHead>Partimer</TableHead>
                <TableHead>Credential</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => {
                const name = c.worker?.name ?? 'Partimer'
                const pill = statePill(c.state)
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="wname">
                        <Avatar className="wav">
                          <AvatarFallback style={{ background: avatarGradient(name) }}>
                            {initials(name)}
                          </AvatarFallback>
                        </Avatar>
                        {name}
                      </div>
                    </TableCell>
                    <TableCell>
                      {c.title}
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.credentialType.name}</div>
                    </TableCell>
                    <TableCell style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {c.referenceNumber || '—'}
                    </TableCell>
                    <TableCell>
                      {fmtDate(c.expiresAt)}
                      {c.expiringSoon && (
                        <div style={{ fontSize: 11, color: 'var(--amber, #E9A23B)' }}>Expiring soon</div>
                      )}
                    </TableCell>
                    <TableCell style={{ color: 'var(--muted)' }}>{fmtDate(c.createdAt)}</TableCell>
                    <TableCell>
                      <StatusPill variant={pill.variant} label={pill.label} />
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="glass" onClick={() => setOpenId(c.id)}>
                        {c.state === 'PENDING' ? 'Review' : 'Open'}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Glass>
      )}

      {openId && (
        <ReviewModal
          id={openId}
          onClose={() => setOpenId(null)}
          onDecided={advance}
        />
      )}
    </>
  )
}

function ReviewModal({
  id,
  onClose,
  onDecided,
}: {
  id: string
  onClose: () => void
  onDecided: (id: string) => void
}) {
  const { data, loading, error } = useApi<CredentialDetail>((signal) => api.credential(id, signal), [id])
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [corrections, setCorrections] = useState<CredentialCorrections>({})
  const [nameConfirmed, setNameConfirmed] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reasonCode, setReasonCode] = useState<RejectionReasonCode>('blurry')
  const [reasonText, setReasonText] = useState('')

  // Reset per credential: carrying a half-typed correction from the previous
  // worker's document onto this one would be a quiet disaster.
  useEffect(() => {
    setCorrections({})
    setNameConfirmed(false)
    setRejecting(false)
    setReasonCode('blurry')
    setReasonText('')
    setActionError(null)
  }, [id])

  const credential = data
  const isPending = credential?.state === 'PENDING'

  const field = <K extends keyof CredentialCorrections>(key: K, current: string | null): string => {
    const override = corrections[key]
    if (override !== undefined) return (override as string) ?? ''
    return current ?? ''
  }

  const approve = useCallback(async () => {
    if (!credential) return
    setBusy(true)
    setActionError(null)
    try {
      await api.reviewCredential(credential.id, {
        decision: 'APPROVE',
        corrections: Object.keys(corrections).length ? corrections : undefined,
      })
      onDecided(credential.id)
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not approve this credential')
    } finally {
      setBusy(false)
    }
  }, [credential, corrections, onDecided])

  const reject = useCallback(async () => {
    if (!credential) return
    setBusy(true)
    setActionError(null)
    try {
      await api.reviewCredential(credential.id, {
        decision: credential.state === 'VERIFIED' ? 'REVOKE' : 'REJECT',
        reasonCode,
        reasonText: reasonCode === 'other' ? reasonText.trim() : undefined,
      })
      onDecided(credential.id)
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not record that decision')
    } finally {
      setBusy(false)
    }
  }, [credential, reasonCode, reasonText, onDecided])

  /**
   * Keyboard shortcuts. A queue worked fifty times a day will not be worked
   * without them. Deliberately ignored while focus is in a field, so typing a
   * corrected reference number cannot approve the record mid-word.
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null
      const typing =
        el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (typing || busy || !isPending) return
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault()
        if (nameConfirmed) void approve()
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        setRejecting(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [approve, busy, isPending, nameConfirmed])

  const docUrl = credential?.document
    ? `/api/me/kyc/documents/file/${encodeURIComponent(credential.document.filename)}`
    : null

  return (
    <Modal open onClose={onClose} title="Review credential" size="wide">
      {loading ? (
        <LoadingState label="Loading…" />
      ) : error || !credential ? (
        <ErrorState message={error ?? 'Not found'} />
      ) : (
        <div className="verif-grid">
          {/* LEFT: the document itself, as large as the space allows. This is
              the thing being judged; everything else is annotation. */}
          <div className="verif-doc">
            {docUrl ? (
              <AuthedImage
                url={docUrl}
                alt={credential.title}
                variant="full"
                style={{ width: '100%', maxHeight: '60vh', objectFit: 'contain', borderRadius: 8 }}
              />
            ) : (
              <div className="verif-nodoc">
                <Icon name="file" size={22} />
                <span>
                  {credential.credentialType.issuerMode === 'AFRIZONE'
                    ? 'Afrizone-issued — evidenced by work history, not a document'
                    : 'No document attached'}
                </span>
              </div>
            )}
          </div>

          {/* RIGHT: who it belongs to, what it claims, and the decision. */}
          <div className="verif-side">
            <div className="verif-worker">
              <Avatar className="wav">
                <AvatarFallback style={{ background: avatarGradient(credential.worker?.name ?? '?') }}>
                  {initials(credential.worker?.name ?? '?')}
                </AvatarFallback>
              </Avatar>
              <div>
                <div style={{ fontWeight: 600 }}>{credential.worker?.name}</div>
                {credential.worker?.kycStatus && (
                  <StatusPill
                    variant={kycPill(credential.worker.kycStatus).variant}
                    label={kycPill(credential.worker.kycStatus).label}
                  />
                )}
              </div>
            </div>

            {credential.courier && (
              <div className="verif-note">
                <Icon name="pin" size={15} />
                <span>
                  Declared vehicle: <strong>{credential.courier.label}</strong>
                  {credential.courier.plateNumber ? (
                    <>
                      {' · plate '}
                      <strong>{credential.courier.plateNumber}</strong>
                    </>
                  ) : (
                    ' · no plate'
                  )}
                  . Check it matches the document.
                </span>
              </div>
            )}

            {credential.duplicateOf && (
              <div className="verif-warn" role="alert">
                <Icon name="alert" size={15} />
                <span>
                  This reference number is already verified on{' '}
                  <strong>{credential.duplicateOf.workerName}</strong>. Worth checking before you
                  approve — but not automatically wrong.
                </span>
              </div>
            )}

            <div className="verif-fields">
              <div>
                <Label htmlFor="v-title">Title</Label>
                <Input
                  id="v-title"
                  value={field('title', credential.title)}
                  disabled={!isPending}
                  onChange={(e) => setCorrections((c) => ({ ...c, title: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="v-issuer">Issuer</Label>
                <Input
                  id="v-issuer"
                  placeholder={credential.credentialType.issuerHint ?? ''}
                  value={field('issuer', credential.issuer)}
                  disabled={!isPending}
                  onChange={(e) => setCorrections((c) => ({ ...c, issuer: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="v-ref">Reference number</Label>
                <Input
                  id="v-ref"
                  style={{ fontFamily: 'monospace' }}
                  value={field('referenceNumber', credential.referenceNumber)}
                  disabled={!isPending}
                  onChange={(e) => setCorrections((c) => ({ ...c, referenceNumber: e.target.value }))}
                />
              </div>
              <div className="verif-dates">
                <div>
                  <Label htmlFor="v-issued">Issued</Label>
                  <Input
                    id="v-issued"
                    type="date"
                    value={
                      corrections.issuedAt !== undefined
                        ? (corrections.issuedAt ?? '')
                        : toDateInput(credential.issuedAt)
                    }
                    disabled={!isPending}
                    onChange={(e) => setCorrections((c) => ({ ...c, issuedAt: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="v-expires">Expires</Label>
                  <Input
                    id="v-expires"
                    type="date"
                    value={
                      corrections.expiresAt !== undefined
                        ? (corrections.expiresAt ?? '')
                        : toDateInput(credential.expiresAt)
                    }
                    disabled={!isPending}
                    onChange={(e) => setCorrections((c) => ({ ...c, expiresAt: e.target.value }))}
                  />
                </div>
              </div>
            </div>

            {credential.otherCredentials.length > 0 && (
              <div className="verif-others">
                <div className="verif-others-h">Their other credentials</div>
                {credential.otherCredentials.map((o: Credential) => (
                  <div key={o.id} className="verif-other">
                    <span>{o.title}</span>
                    <StatusPill
                      variant={statePill(o.state).variant}
                      label={statePill(o.state).label}
                    />
                  </div>
                ))}
              </div>
            )}

            {actionError && (
              <div className="login-error" role="alert">
                <Icon name="alert" size={15} />
                {actionError}
              </div>
            )}

            {isPending ? (
              rejecting ? (
                <div className="verif-reject">
                  <Label>Why is it being turned down?</Label>
                  <p className="verif-hint">The Partimer is shown this, so it has to tell them what to do next.</p>
                  {REASONS.map((r) => (
                    <label key={r.code} className="verif-radio">
                      <input
                        type="radio"
                        name="reason"
                        checked={reasonCode === r.code}
                        onChange={() => setReasonCode(r.code)}
                      />
                      {r.label}
                    </label>
                  ))}
                  {reasonCode === 'other' && (
                    <Textarea
                      value={reasonText}
                      onChange={(e) => setReasonText(e.target.value)}
                      placeholder="Tell them what was wrong, and what to send instead."
                      rows={3}
                    />
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button
                      variant="danger"
                      loading={busy}
                      disabled={reasonCode === 'other' && reasonText.trim().length < 10}
                      onClick={reject}
                    >
                      Send decision
                    </Button>
                    <Button variant="glass" onClick={() => setRejecting(false)}>
                      Back
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="verif-actions">
                  {/* The one thing a reviewer can most easily skip, and the one
                      most often wrong: does the document actually belong to
                      this person? Made explicit rather than assumed. */}
                  <label className="verif-check">
                    <input
                      type="checkbox"
                      checked={nameConfirmed}
                      onChange={(e) => setNameConfirmed(e.target.checked)}
                    />
                    The name on the document matches {credential.worker?.name}
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="money" loading={busy} disabled={!nameConfirmed} onClick={approve}>
                      Approve
                    </Button>
                    <Button variant="danger" onClick={() => setRejecting(true)}>
                      Reject
                    </Button>
                  </div>
                  <p className="verif-hint">
                    <kbd>A</kbd> approve · <kbd>R</kbd> reject
                  </p>
                </div>
              )
            ) : (
              <div className="verif-decided">
                <StatusPill
                  variant={statePill(credential.state).variant}
                  label={statePill(credential.state).label}
                />
                {credential.rejectionReason && <p>{credential.rejectionReason}</p>}
                {credential.reviewedBy && (
                  <p className="verif-hint">
                    Reviewed by {credential.reviewedBy.name} on {fmtDate(credential.reviewedAt)}
                  </p>
                )}
                {credential.state === 'VERIFIED' && (
                  <Button variant="danger" size="sm" onClick={() => setRejecting(true)}>
                    Revoke
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
