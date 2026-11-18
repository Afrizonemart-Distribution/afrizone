import { lazy, Suspense } from 'react'
import { api } from '../api/client'
import { useApi } from '../lib/useApi'
import { formatNaira, formatNairaCompact } from '../lib/format'
import PageHeader from '../components/PageHeader'
import Glass from '../components/ui/Glass'
import Button from '../components/ui/Button'
import KpiCard from '../components/ui/KpiCard'
import Icon from '../components/Icon'
import { ErrorState, LoadingState } from '../components/ui/StateView'
import type { ReportsSummary } from '../api/types'
import '../pages/Dashboard.css'
import './Reports.css'
import { Skeleton } from '@/components/shadcn/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/shadcn/table'

/* Lazy so bklit's visx and Motion dependencies stay out of the initial bundle.
   All three come from the same module, so they share one chunk. */
const SpendChart = lazy(() =>
  import('../components/chart-views').then((m) => ({ default: m.SpendChart })),
)
const CategoryChart = lazy(() =>
  import('../components/chart-views').then((m) => ({ default: m.CategoryChart })),
)
const FillRateTrendChart = lazy(() =>
  import('../components/chart-views').then((m) => ({ default: m.FillRateTrendChart })),
)

function exportSummary(data: ReportsSummary) {
  // Non-blocking stub: download the summary as JSON.
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `afrizone-report-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function Reports() {
  const { data, loading, error, reload } = useApi((signal) => api.reportsSummary(signal))

  if (loading) return <LoadingState label="Loading reports…" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return null

  const pe = data.payrollEquivalent

  return (
    <>
      <PageHeader
        crumb="Insights / Reports"
        title="Financial reports"
        sub="Payroll-equivalent spend, withholding tax and category breakdowns"
        actions={
          <Button
            variant="glass"
            size="sm"
            icon="download"
            onClick={() => exportSummary(data)}
          >
            Export
          </Button>
        }
      />

      <div className="kpis">
        <KpiCard
          tone="k1"
          icon="naira"
          iconColor="var(--clay)"
          label="Gross paid"
          value={pe.grossPaid / 1_000_000}
          decimals={2}
          prefix="₦"
          suffix="M"
          delta="All released + approved"
        />
        <KpiCard
          tone="k2"
          icon="percent"
          iconColor="var(--gold)"
          label="Total WHT"
          value={pe.totalWht}
          prefix="₦"
          delta="Withheld at source"
          deltaTone="warn"
          delay="d1"
        />
        <KpiCard
          tone="k3"
          icon="check-circle"
          iconColor="var(--money)"
          label="Net paid"
          value={pe.netPaid / 1_000_000}
          decimals={2}
          prefix="₦"
          suffix="M"
          delta="To Partimer wallets"
          delay="d2"
        />
        <KpiCard
          tone="k4"
          icon="users"
          iconColor="var(--indigo)"
          label="Partimers paid"
          value={pe.workersPaid}
          delta="Payroll-equivalent"
          delay="d3"
        />
      </div>

      <div className="dash">
        <Glass reveal delay="d1" style={{ padding: 22 }}>
          <div className="card-h">
            <div>
              <h3>Monthly spend</h3>
              <div className="sub">Last {data.spendByMonth.length} months</div>
            </div>
            <span className="chip">Naira</span>
          </div>
          <Suspense fallback={<Skeleton className="w-full rounded-[var(--r-sm)]" style={{ height: 240 }} />}>
            <SpendChart data={data.spendByMonth} />
          </Suspense>
        </Glass>

        <Glass reveal delay="d2" style={{ padding: 22 }}>
          <div className="card-h">
            <div>
              <h3>Tax summary</h3>
              <div className="sub">Withholding tax · FIRS</div>
            </div>
          </div>
          <div className="taxgrid">
            <div className="taxbox">
              <span className="tlbl">
                <Icon name="percent" /> WHT collected
              </span>
              <b className="tnum">{formatNaira(data.tax.whtCollected)}</b>
            </div>
            <div className="taxbox">
              <span className="tlbl">
                <Icon name="naira" /> VAT collected
              </span>
              <b className="tnum">{formatNaira(data.tax.vatCollected)}</b>
            </div>
            <div className="taxbox span2">
              <span className="tlbl">
                <Icon name="send" /> Remitted to FIRS
              </span>
              <b className="tnum" style={{ color: 'var(--money)' }}>
                {formatNaira(data.tax.remittedToFirs)}
              </b>
            </div>
          </div>
          <div className="math" style={{ marginTop: 14 }}>
            <Icon name="help" size={15} style={{ color: 'var(--gold)' }} />
            WHT is deducted at source and remitted on the Partimer&apos;s behalf.
          </div>
        </Glass>
      </div>

      <div className="dash section-gap">
        <Glass reveal delay="d2" style={{ padding: 22 }}>
          <div className="card-h">
            <div>
              <h3>Spend by category</h3>
              <div className="sub">{data.spendByCategory.length} categories</div>
            </div>
          </div>
          <Suspense fallback={<Skeleton className="w-full rounded-[var(--r-sm)]" style={{ height: 240 }} />}>
            <CategoryChart data={data.spendByCategory} />
          </Suspense>
        </Glass>

        <Glass reveal delay="d3" style={{ padding: 22 }}>
          <div className="card-h">
            <div>
              <h3>Fill rate trend</h3>
              <div className="sub">Per monthly task cohort</div>
            </div>
            <span className="chip">%</span>
          </div>
          <Suspense fallback={<Skeleton className="w-full rounded-[var(--r-sm)]" style={{ height: 240 }} />}>
            <FillRateTrendChart data={data.fillRateTrend} />
          </Suspense>
        </Glass>
      </div>

      <div className="dash section-gap">
        <Glass reveal delay="d1" className="tablewrap" style={{ padding: 0 }}>
          <div className="card-h" style={{ padding: '22px 22px 0' }}>
            <div>
              <h3>Top categories</h3>
              <div className="sub">By spend</div>
            </div>
          </div>
          <Table className="dt" style={{ marginTop: 14 }}>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Tasks</TableHead>
                <TableHead>Spend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.topCategories.map((c, i) => (
                <TableRow key={c.label + i}>
                  <TableCell>{c.label}</TableCell>
                  <TableCell className="tnum">{c.tasks}</TableCell>
                  <TableCell className="tnum" style={{ fontWeight: 700 }}>
                    {formatNairaCompact(c.spend)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Glass>
      </div>
    </>
  )
}
