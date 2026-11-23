/**
 * The staff workspace client (server: routes/staffWorkspace.ts).
 *
 * Its own session, separate from a worker's: an AfriZone staff member reaches
 * only /api/staff/*. The token lives in secure storage under its own key.
 */
import { API_BASE_URL } from '../api/config';
import { deleteItem, getItem, setItem } from './storage';

const KEY = 'afrizone.staff.jwt';

export class StaffApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function hasStaffSession(): Promise<boolean> {
  return !!(await getItem(KEY));
}
export async function clearStaffSession(): Promise<void> {
  await deleteItem(KEY);
}

async function call<T>(path: string, opts: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH'; body?: unknown } = {}): Promise<T> {
  const token = await getItem(KEY);
  const res = await fetch(`${API_BASE_URL}/staff${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) {
    if (res.status === 401) await deleteItem(KEY);
    throw new StaffApiError(json.error ?? json.message ?? 'Something went wrong', res.status);
  }
  return json as T;
}

/** My HR (AZM HR Console) and anything else under /api/staff. */
export const staffCall = call;

/** Download a My HR document with the staff session and open the share sheet. */
export async function staffOpenFile(path: string, filename: string): Promise<void> {
  const FileSystem = await import('expo-file-system/legacy');
  const Sharing = await import('expo-sharing');
  const token = await getItem(KEY);
  const dest = `${FileSystem.cacheDirectory}${filename.replace(/[^\w.-]/g, '_')}`;
  const res = await FileSystem.downloadAsync(`${API_BASE_URL}/staff${path}`, dest, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (res.status !== 200) throw new StaffApiError('Could not open the document', res.status);
  await Sharing.shareAsync(res.uri, { mimeType: res.headers['Content-Type'] ?? res.headers['content-type'] });
}

export interface StaffMe {
  id: string;
  name: string | null;
  email: string | null;
  jobTitle: string | null;
  manages: number;
  monitor: boolean;
}

/** Swap an AfriZone identity token for a staff session. */
export async function startStaffSession(identityToken: string): Promise<StaffMe> {
  const res = await fetch(`${API_BASE_URL}/staff/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identityToken }),
  });
  const json = (await res.json().catch(() => ({}))) as { token?: string; me?: StaffMe; error?: string };
  if (!res.ok || !json.token || !json.me) throw new StaffApiError(json.error ?? 'Could not sign you in', res.status);
  await setItem(KEY, json.token);
  return json.me;
}

export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'SUBMITTED' | 'REWORK' | 'DONE' | 'CANCELLED';

export interface StaffTask {
  id: string;
  title: string;
  description: string | null;
  product: string;
  kind: 'WORK' | 'OFFSITE';
  status: TaskStatus;
  dueAt: string | null;
  completion?: 'MANUAL' | 'AUTO';
  autoProgress?: number;
  autoTarget?: number | null;
  overdue: boolean;
  assignee: { id: string; name: string | null; email: string | null };
  permissions: { canStart: boolean; canSubmit: boolean; canApprove: boolean; canRework: boolean };
}

export interface Scorecard {
  kind: 'STAFF' | 'INTERN';
  score: number | null;
  staff: { pillars: Record<string, { score: number | null; weight: number }> } | null;
  intern: { deliverables: { submitted: number; approved: number; rejected: number; trend: number } } | null;
  overdueOpen: number;
  flags: string[];
}

export interface TeamRow {
  person: { id: string; name: string | null; email: string | null; jobTitle: string | null };
  kind: 'STAFF' | 'INTERN';
  score: number | null;
  flags: string[];
  overdueOpen: number;
}

export const staffApi = {
  me: () => call<StaffMe>('/me'),
  tasks: (scope: 'mine' | 'review') =>
    call<{ items: StaffTask[] }>(
      `/tasks?scope=${scope}&pageSize=50${scope === 'mine' ? '&status=OPEN,IN_PROGRESS,SUBMITTED,REWORK' : ''}`,
    ),
  start: (id: string) => call<StaffTask>(`/tasks/${id}/start`, { method: 'POST', body: {} }),
  submit: (id: string, note?: string) => call<StaffTask>(`/tasks/${id}/submit`, { method: 'POST', body: { note } }),
  approve: (id: string, qualityScore: number) =>
    call<StaffTask>(`/tasks/${id}/approve`, { method: 'POST', body: { qualityScore } }),
  rework: (id: string, note: string) => call<StaffTask>(`/tasks/${id}/rework`, { method: 'POST', body: { note } }),
  logOffsite: (body: { product: string; title: string; startAt: string; endAt: string; location: string }) =>
    call<StaffTask>('/tasks/offsite', { method: 'POST', body }),
  myKpi: (period: 'week' | 'month') => call<Scorecard>(`/kpi/me?period=${period}`),
  teamKpi: (period: 'week' | 'month', scope: 'team' | 'all') =>
    call<{ items: TeamRow[] }>(`/kpi/team?period=${period}&scope=${scope}`),
};
