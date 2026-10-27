import { useState } from 'react'
import { useApi } from '../lib/useApi'
import { auditPill, formatDate, orgPill } from '../lib/format'
import { api } from '../api/client'
import type { AuditOutcome, AuditResult } from '../api/types'
import PageHeader from '../components/PageHeader'
import Glass from '../components/ui/Glass'
import StatusPill from '../components/ui/StatusPill'
import EvidenceButton from '../components/EvidenceButton'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateView'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/shadcn/table'

/**
 * Every store audit finding (server: routes/audits.ts).
 *
 * The store's own page shows its latest audit, which is what an approval
 * needs. This is for the questions across stores: which ones failed, what the
 * auditors are scoring, and whether each score has anything behind it.
 *
 * THE PROOF COLUMN IS THE POINT. A score with three clean photos and the
 * manager's signature is a finding; a score with neither is somebody's word.
 * The counts make the difference visible down the whole list, and the button
 * opens the photos and signature themselves.
 */
type Filter = 'ALL' | AuditOutcome

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'FAIL', label: 'Failed' },
  { key: 'PASS', label: 'Passed' },
]

export default function Audits() {
  const [filter, setFilter] = useState<Filter>('ALL')
  const { data, loading, error, reload } = useApi((signal) => api.audits(filter, signal), [filter])

  const audits = data?.audits ?? []
  const counts = data?.counts

  return (
    <>
      <PageHeader
        crumb="People / Audits"
        title="Store audits"
        sub={
          loading || !counts
            ? 'Loading…'
            : `${counts.ALL} finding${counts.ALL === 1 ? '' : 's'} · ${counts.FAIL} failed`
        }
      />

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`btn btn-sm ${filter === f.key ? 'btn-primary' : 'btn-glass'}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            {counts && f.key !== 'ALL' && counts[f.key] > 0 && (
              <span className="badge" style={{ marginLeft: 6 }}>
                {counts[f.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingState label="Loading audits…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : audits.length === 0 ? (
        <Glass>
          <EmptyState
            icon="shield"
            title="No audits"
            sub={
              filter === 'ALL'
                ? 'Findings appear here when an auditor files one, or an admin records one on a store.'
                : `No ${filter === 'FAIL' ? 'failed' : 'passed'} audits.`
            }
          />
        </Glass>
      ) : (
        <Glass reveal delay="d1" className="tablewrap">
          <Table className="dt">
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Auditor</TableHead>
                <TableHead>Proof</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Filed</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {audits.map((a) => (
                <AuditRow key={a.id} a={a} />
              ))}
            </TableBody>
          </Table>
        </Glass>
      )}
    </>
  )
}

function AuditRow({ a }: { a: AuditResult }) {
  const pill = auditPill(a.outcome)
  const store = orgPill(a.organization.status)
  return (
    <TableRow>
      <TableCell>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{a.organization.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <StatusPill variant={store.variant} label={store.label} />
        </div>
      </TableCell>
      <TableCell>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{a.score}</span>
          <StatusPill variant={pill.variant} label={pill.label} />
        </div>
      </TableCell>
      <TableCell style={{ fontSize: 13 }}>{a.auditor?.name ?? (a.auditor ? 'Auditor' : 'Recorded by staff')}</TableCell>
      <TableCell>
        <ProofSummary a={a} />
      </TableCell>
      <TableCell>
        <span
          title={a.notes ?? undefined}
          style={{
            display: 'block',
            maxWidth: 220,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 13,
            color: a.notes ? 'var(--text)' : 'var(--muted)',
          }}
        >
          {a.notes ?? '—'}
        </span>
      </TableCell>
      <TableCell style={{ color: 'var(--muted)', fontSize: 12 }}>{formatDate(a.createdAt)}</TableCell>
      <TableCell>
        {a.taskId && (a.proof.photos > 0 || a.proof.signed) ? (
          <EvidenceButton taskId={a.taskId} workerId={a.auditor?.id} label="Proof" />
        ) : null}
      </TableCell>
    </TableRow>
  )
}

/** Photos, signature and failed checks in one line, worst news first. */
function ProofSummary({ a }: { a: AuditResult }) {
  const { photos, signed, flagged } = a.proof
  if (!a.taskId) {
    return <span style={{ fontSize: 12, color: 'var(--muted)' }}>Recorded by staff</span>
  }
  if (photos === 0 && !signed) {
    return <span style={{ fontSize: 12, color: 'var(--gold-ink, #8a5a00)', fontWeight: 700 }}>Nothing filed</span>
  }
  return (
    <div style={{ fontSize: 12, lineHeight: 1.45 }}>
      {flagged > 0 && (
        <div style={{ color: 'var(--gold-ink, #8a5a00)', fontWeight: 700 }}>
          {flagged} check{flagged === 1 ? '' : 's'} failed
        </div>
      )}
      <div style={{ color: 'var(--muted)' }}>
        {photos} photo{photos === 1 ? '' : 's'} · {signed ? 'signed' : 'not signed'}
      </div>
    </div>
  )
}
