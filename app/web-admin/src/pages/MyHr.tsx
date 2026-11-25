/**
 * My HR for Part Time console staff: their own leave, pay, documents and
 * claims, like every other AZM staff member gets in their own admin. The
 * screens are the shared My HR module (components/my-hr, identical in every
 * staff admin); this page only points it at the console's relay,
 * /api/admin/my-hr (server: routes/consoleMyHr.ts).
 */
import { useMemo } from 'react'
import MyHrScreens, { type MyHrClient } from '../components/my-hr/MyHr'
import { ApiError, API_ORIGIN, getToken, request } from '../api/client'

export default function MyHr() {
  const client = useMemo<MyHrClient>(
    () => ({
      call: (path, init) => request(`/admin/my-hr${path}`, { method: init?.method ?? 'GET', body: init?.body }),
      file: async (path) => {
        const token = getToken()
        const res = await fetch(`${API_ORIGIN}/api/admin/my-hr${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        if (!res.ok) throw new ApiError('Could not open that document.', res.status)
        return res.blob()
      },
    }),
    [],
  )
  return <MyHrScreens client={client} />
}
