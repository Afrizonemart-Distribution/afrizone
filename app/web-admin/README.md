# Afrizone Part Time — Admin Web

Premium dark-glassmorphism admin console for the Afrizone Part Time gig platform.
Built with **Vite + React + TypeScript + React Router v6** and plain CSS ported from
the `admin-premium.html` prototype (Deep Navy `#000066` + Sea Buckthorn `#fbac34`
brand, Raleway, animated gradient-mesh background, KPI count-ups, animated
bar/donut, glass tables, task cards with hover spotlight).

## Getting started

```bash
npm install
npm run dev
```

The dev server runs on **http://localhost:5173** and proxies `/api` →
**http://localhost:4000**, so the backend API must be running on port 4000.

### Login

```
admin@afrizone.work / afrizone123
```

The JWT is stored in `localStorage`; protected routes redirect to `/login` when no
valid session is present.

## Scripts

| Command           | Description                                  |
| ----------------- | -------------------------------------------- |
| `npm run dev`     | Start the Vite dev server (port 5173)        |
| `npm run build`   | Type-check (`tsc -b`) and build for prod     |
| `npm run preview` | Preview the production build                 |

## What's wired

| Route            | API                                                                       |
| ---------------- | ------------------------------------------------------------------------- |
| `/` Dashboard    | `GET /api/dashboard/stats` — KPIs (count-up), bar chart, donut, urgent, activity |
| `/tasks`         | `GET /api/tasks`, `POST /api/tasks` (New task modal)                       |
| `/applications`  | `GET /api/applications?status=APPLIED`, approve / reject-with-reason       |
| `/timesheets`    | `GET /api/timesheets?status=SUBMITTED`, approve / dispute, SLA countdown   |
| `/payments`      | `GET /api/payments`, `POST /payments/:id/release`, `release-all`; gross → −WHT → net |
| `/workers`       | `GET /api/workers`, `POST /workers/:id/kyc` (approve / reject)             |

Every page renders explicit **loading / error / empty** states. Money uses the
`formatNaira` helper (₦ + thousands separators, `tabular-nums`). Status is never
communicated by colour alone — every pill carries an icon and a word.

## Project structure

```
src/
  api/        client.ts (fetch wrapper + auth), types.ts (contract types)
  auth/       AuthContext.tsx (login/logout/me + ProtectedRoute)
  components/ AppShell, Sidebar, Topbar, Background, PageHeader, Icon
    ui/       Button, Glass, StatusPill, KpiCard, Modal, StateView  ← branded, hand-written
    shadcn/   generated shadcn/ui primitives — kept stock, never hand-edited
  lib/        format.ts, useApi.ts, useCountUp.ts, utils.ts (`cn`)
  pages/      Login, Dashboard, Tasks, Payments, Workers, Applications, Timesheets,
              Hiring, Disputes, Reports, Settings, ForgotPassword, ResetPassword
  styles/     tokens.css, global.css, tailwind.css (Tailwind + shadcn token bridge)
```

## shadcn/ui

Tailwind v4 and shadcn/ui sit **alongside** the hand-written CSS rather than
replacing it, so pages can move over one at a time.

```bash
npx shadcn@latest add <component>     # → src/components/shadcn/<component>.tsx
```

Three rules keep the two systems from fighting:

1. **Generated files stay stock.** Anything in `src/components/shadcn/` is
   regenerable; branding goes in a wrapper under `src/components/ui/` (see
   `Modal.tsx`, which wraps the shadcn Dialog behind the app's own props). Where
   a shadcn internal can't be reached through `className`, override it by its
   `data-slot` attribute in `tailwind.css`.
2. **No Preflight.** `global.css` already has its own reset; loading Tailwind's
   would restyle every existing page. `tailwind.css` imports only the `theme`
   and `utilities` layers and re-adds the one Preflight rule utilities depend on.
3. **`global.css` is imported into an `app` cascade layer** below `utilities`, so
   Tailwind classes win over bare element selectors like `button { border:none }`.
   Per-component stylesheets stay unlayered and still outrank utilities.

shadcn's semantic colours are mapped onto the existing tokens (`--sd-*` in
`tailwind.css`) — `bg-primary` is Sea Buckthorn, `border-border` is `--line`,
`rounded-lg` is `--r-sm`. No shadcn component introduces a colour of its own.

Respects `prefers-reduced-motion`, uses visible focus rings, and keeps 44px tap targets.
