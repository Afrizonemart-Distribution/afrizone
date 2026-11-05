import { useMemo, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useApi } from '../lib/useApi'
import { avatarGradient, formatNaira, initials, paymentPill } from '../lib/format'
import type { Payment } from '../api/types'
import PageHeader from '../components/PageHeader'
import Glass from '../components/ui/Glass'
import Button from '../components/ui/Button'
import StatusPill from '../components/ui/StatusPill'
import Icon from '../components/Icon'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateView'
import { Avatar, AvatarFallback } from '@/components/shadcn/avatar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/shadcn/table'

export default function Payments() {
  const { data, loading, error, reload, setData } = useApi((signal) => api.payments(undefined, signal))
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const payments = useMemo(() => data ?? [], [data])
  const approved = payments.filter((p) => p.status === 'APPROVED')
  const pendingNet = approved.reduce((s, p) => s + p.net, 0)

  async function release(id: string) {
    setBusy(id)
    setActionError(null)
    try {
      const updated = await api.releasePayment(id)
      setData((prev) => (prev ?? []).map((p) => (p.id === id ? { ...p, ...updated } : p)))
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Release failed')
    } finally {
      setBusy(null)
    }
  }

  async function releaseAll() {
    setBusy('all')
    setActionError(null)
    try {
      const r = await api.releaseAll()
      if (r.heldBack) {
        setActionError(
          `${r.heldBack} large payment${r.heldBack === 1 ? '' : 's'} you approved yourself ${r.heldBack === 1 ? 'was' : 'were'} left for another admin to release`,
        )
      }
      reload()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Release-all failed')
      setBusy(null)
    }
  }

  // sample row for the always-visible money math (first approved, else first row)
  const sample: Payment | undefined = approved[0] ?? payments[0]

  return (
    <>
      <PageHeader
        crumb="Operations / Payments"
        title="Payment release queue"
        sub={
          loading ? (
            'Loading…'
          ) : (
            <>
              {approved.length} approved ·{' '}
              <b style={{ color: 'var(--text)' }}>{formatNaira(pendingNet)}</b> net pending · WHT
              auto-calculated at source
            </>
          )
        }
        actions={
          <Button
            variant="primary"
            size="sm"
            icon="check"
            loading={busy === 'all'}
            disabled={approved.length === 0}
            onClick={releaseAll}
          >
            Release all approved
          </Button>
        }
      />

      {actionError && (
        <div className="login-error" role="alert" style={{ marginBottom: 16 }}>
          <Icon name="alert" size={15} />
          {actionError}
        </div>
      )}

      {loading ? (
        <LoadingState label="Loading payments…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : payments.length === 0 ? (
        <Glass>
          <EmptyState icon="card" title="No payments yet" sub="Approved timesheets create payments here, ready to release." />
        </Glass>
      ) : (
        <>
          <Glass reveal delay="d1" className="tablewrap">
            <Table className="dt">
              <TableHeader>
                <TableRow>
                  <TableHead>Worker</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Gross</TableHead>
                  <TableHead>− WHT 5%</TableHead>
                  <TableHead>Net payout</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => {
                  const pill = paymentPill(p.status)
                  const name = p.worker?.name ?? 'Worker'
                  return (
                    <TableRow key={p.id}>
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
                      <TableCell>{p.task?.title ?? '—'}</TableCell>
                      <TableCell className="tnum">{formatNaira(p.gross)}</TableCell>
                      <TableCell className="tnum neg">{formatNaira(p.whtAmount)}</TableCell>
                      <TableCell className="tnum" style={{ fontWeight: 700 }}>
                        {formatNaira(p.net)}
                      </TableCell>
                      <TableCell>
                        <StatusPill variant={pill.variant} label={pill.label} />
                      </TableCell>
                      <TableCell>
                        {p.status === 'APPROVED' ? (
                          <Button
                            variant="money"
                            size="sm"
                            loading={busy === p.id}
                            onClick={() => release(p.id)}
                          >
                            Release
                          </Button>
                        ) : p.status === 'RELEASED' ? (
                          <span className="pill paid">
                            <Icon name="check" />
                            Paid
                          </span>
                        ) : (
                          <Button variant="glass" size="sm" disabled>
                            {p.status === 'DISPUTED' ? 'On hold' : 'In review'}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Glass>

          {sample && (
            <Glass
              reveal
              delay="d2"
              style={{
                padding: '16px 20px',
                marginTop: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                flexWrap: 'wrap',
              }}
            >
              <span className="math">
                <Icon name="help" size={16} style={{ color: 'var(--gold)' }} /> The worker always
                sees the math:
              </span>
              <span className="math">
                Gross <b>{formatNaira(sample.gross)}</b>
              </span>
              <span style={{ color: 'var(--faint)' }}>→</span>
              <span className="math">
                − WHT {Math.round(sample.whtRate * 100)}%{' '}
                <b className="neg">{formatNaira(sample.whtAmount)}</b>
              </span>
              <span style={{ color: 'var(--faint)' }}>→</span>
              <span className="math">
                Net to wallet <b style={{ color: 'var(--money)' }}>{formatNaira(sample.net)}</b>
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--faint)' }}>
                WHT remitted to FIRS · deduction statement auto-issued
              </span>
            </Glass>
          )}
        </>
      )}
    </>
  )
}
