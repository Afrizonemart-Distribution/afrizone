/**
 * AZM HR Console client. Every call goes to /api/admin/hr/* on our server,
 * which passes it to Afrizonemart with the HR service token. Nothing about
 * AZM staff is stored in Part Time.
 */
import { API_ORIGIN, ApiError, getToken, request } from '../api/client'

export type HrCap = 'hr.view' | 'hr.manage' | 'hr.sensitive' | 'hr.payroll' | 'hr.payroll.approve'

export function hr<T>(path: string, opts: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; signal?: AbortSignal } = {}) {
  return request<T>(`/admin/hr${path.startsWith('/') ? path : `/${path}`}`, opts)
}

/** Download a CSV or open a document: fetch with the session, then hand the blob to the browser. */
export async function hrFile(path: string, opts: { download?: string } = {}): Promise<void> {
  const res = await fetch(`${API_ORIGIN}/api/admin/hr${path}`, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(body.error ?? 'Could not open the file', res.status)
  }
  const url = URL.createObjectURL(await res.blob())
  if (opts.download) {
    const a = document.createElement('a')
    a.href = url
    a.download = opts.download
    a.click()
  } else {
    window.open(url, '_blank', 'noopener')
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Read a picked file as base64 for the upload endpoints. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(new Error('Could not read the file'))
    r.readAsDataURL(file)
  })
}

export const STAFF_TYPES = [
  { value: 'FULL_TIME', label: 'Full-time' },
  { value: 'CONTRACT', label: 'Contract' },
  { value: 'INTERN', label: 'Intern' },
]
export const typeLabel = (t: string) => STAFF_TYPES.find((s) => s.value === t)?.label ?? t

export const PRODUCTS: Record<string, string> = {
  STOREFRONT: 'Storefront',
  SUPPLIER_OPS: 'Supplier Ops',
  INK: 'Ink',
  HUD: 'HUD',
  PARTTIME: 'Part Time',
}
export const productLabel = (p: string | null | undefined) => (p ? PRODUCTS[p] ?? p : '—')

/** kobo → "₦12,345.00" */
export function naira(kobo: number | null | undefined, decimals = 2): string {
  if (kobo === null || kobo === undefined) return '—'
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

export const today = () => {
  const d = new Date(Date.now() + 60 * 60 * 1000) // Lagos
  return d.toISOString().slice(0, 10)
}
export const addDays = (key: string, n: number) => new Date(new Date(`${key}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)

export function niceDate(key: string | null | undefined): string {
  if (!key) return '—'
  const d = new Date(key.length === 10 ? `${key}T00:00:00Z` : key)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}
export function niceTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' })
}
export function hours(seconds: number): string {
  if (!seconds) return '0h'
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m`
}
export function ago(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} days ago`
}
