# Afrizone Part Time: API Contract v1 (MVP slice)

**Read "The rest of the API" at the bottom first if you are looking for anything
built after the v3 slice.** This file grew as three chronological slices (v1, v2,
v3) that between them cover 54 of the 148 endpoints the server serves. Everything
since — organizations and stores, courier profiles, credentials, store audits,
CAC, disputes, the Mart event bus, deliveries and self-claim — is documented in
one section at the end rather than retrofitted into the slices above, because the
slices are a record of what was agreed when, and rewriting them would destroy
that without making anything clearer.

The v1–v3 sections are still accurate. They are simply not the whole surface.

Backend runs on **http://localhost:4000**, all routes prefixed **`/api`**. Frontend dev server proxies `/api` → `:4000`.

Auth: `Authorization: Bearer <jwt>`. Money is in **kobo** is NOT used: all amounts are **whole Naira integers** (e.g. `18000` = ₦18,000). WHT default rate **5%** (`0.05`), configurable per task category later. `net = round(gross - gross*whtRate)`.

---

## Enums
- `Role`: `SUPER_ADMIN | TASK_MANAGER | HR_ADMIN | WORKER`
- `Tier`: `STUDENT | DISPATCH | REMOTE | PROMO | TRADE`
- `KycStatus`: `PENDING | VERIFIED | TIER_APPROVED | REJECTED`
- `PayModel`: `HOURLY | FIXED`
- `LocationType`: `PHYSICAL | REMOTE`
- `TaskStatus`: `OPEN | FILLED | CLOSED | ARCHIVED`
- `AppStatus`: `APPLIED | APPROVED | REJECTED`
- `TimesheetStatus`: `SUBMITTED | APPROVED | DISPUTED`
- `PaymentStatus`: `PENDING | APPROVED | RELEASED | DISPUTED`

## Entities (Prisma models: backend owns exact schema)
- **User**: `id, name, email, passwordHash, role, tiers (Tier[]), kycStatus, location, rating (float?), completedCount (int), bankMasked (string?), createdAt`
- **Task**: `id, title, description, category, tier, payModel, rate (int?), budget (int?), startDate, endDate, locationType, address?, geofenceRadius (int default 100), slots (int), status, deadline, createdById, createdAt`
- **Application**: `id, taskId, workerId, pitch?, status, reason?, createdAt`
- **Timesheet**: `id, taskId, workerId, periodStart, periodEnd, hours (float), status, gpsNote?, createdAt`
- **Payment**: `id, workerId, taskId, gross (int), whtRate (float), whtAmount (int), net (int), status, createdAt`
- **AuditLog**: `id, actorId, action, entity, entityId, meta (json/string), createdAt`

Derived **wallet** per worker: `pending = Σ net where status in (PENDING,APPROVED)`, `available = Σ net where RELEASED & not withdrawn`, `withdrawn` (mock 0 for MVP).

---

## Endpoints

### Auth
- `POST /api/auth/login` → body `{email, password}` → `200 {token, user}` | `401 {error}`
- `GET /api/auth/me` → `{user}` (requires auth)

Seed an admin: **email `admin@afrizone.work` / password `afrizone123`** (role SUPER_ADMIN).

### Dashboard
- `GET /api/dashboard/stats` →
```json
{
  "activeTasks": 38,
  "fillRate": 87,
  "avgTimeToFillHours": 6,
  "spendThisMonth": 4860000,
  "budgetThisMonth": 5400000,
  "spendByCategory": [{"label":"Dispatch","value":62,"tone":"clay"}, ...],
  "fill": {"filled":132,"open":20},
  "urgent": [{"type":"payments","title":"12 payments ready to release","sub":"₦486,000 net","count":12}, ...],
  "activity": [{"icon":"check","title":"Amaka O. approved","sub":"Mall activation","ago":"2m"}, ...]
}
```
(Compute what you can from seeded data; static-ish values acceptable for chart breakdowns.)

### Tasks
- `GET /api/tasks` → `Task[]` each augmented with `filledCount (int)`, `applicantCount (int)`
- `POST /api/tasks` → body = task fields (title, description, category, tier, payModel, rate|budget, startDate, endDate, locationType, address?, geofenceRadius?, slots, deadline) → `201 Task`
- `GET /api/tasks/:id` → `Task` + `applications: Application[]` (with worker summary)
- `PATCH /api/tasks/:id` → partial update → `Task`

### Applications
- `GET /api/applications?status=APPLIED` → `Application[]` joined with `worker {id,name,tiers,kycStatus,rating}` and `task {id,title}`
- `POST /api/applications/:id/approve` → `Application` (also bumps task filled; on full → task FILLED)
- `POST /api/applications/:id/reject` → body `{reason}` → `Application`

### Timesheets
- `GET /api/timesheets?status=SUBMITTED` → joined with worker + task + computed `slaHoursLeft`
- `POST /api/timesheets/:id/approve` → creates a `Payment` (PENDING→APPROVED) computing gross from `hours*task.rate` (or task.budget for FIXED)
- `POST /api/timesheets/:id/dispute` → body `{reason}`

### Payments
- `GET /api/payments?status=` → `Payment[]` joined with `worker {id,name}` and `task {id,title}`; include `gross, whtRate, whtAmount, net, status`
- `POST /api/payments/:id/release` → sets RELEASED, writes AuditLog → `Payment`
- `POST /api/payments/release-all` → releases all APPROVED → `{released: n, totalNet}`

### Workers
- `GET /api/workers` → users where role=WORKER: `{id,name,email,tiers,kycStatus,completedCount,rating}`
- `GET /api/workers/:id` → full worker + their applications/payments summary
- `POST /api/workers/:id/kyc` → body `{decision: "TIER_APPROVED"|"REJECTED"}` → updates kycStatus, AuditLog

---

## Error shape
All errors: `{ "error": "human message" }` with appropriate HTTP status (400/401/403/404/500).

## CORS
Backend enables CORS for `http://localhost:5173` (Vite dev) and same-origin.

## Seed data (must match prototype demo)
Workers: Amaka Obi (PROMO, VERIFIED, 47, 4.9), Tunde Bello (DISPATCH, VERIFIED, 89, 4.8), Ngozi Eze (REMOTE, PENDING, 12, 4.7), Ibrahim Kola (DISPATCH, VERIFIED), Funke Ade (PROMO).
Tasks: "Same-day parcel runs: Yaba" (DISPATCH, HOURLY ₦2500), "Weekend mall activation: Ikeja" (PROMO, FIXED ₦18000, 5 slots), "Product data cleanup: 20h" (REMOTE, HOURLY ₦1800), "AC servicing: Lekki" (TRADE, FIXED ₦45000), "Campus survey: UNILAG" (STUDENT, HOURLY ₦1200, 10 slots).
Payments: Amaka ₦18,000 (APPROVED), Tunde ₦12,500 (review/PENDING), Ngozi ₦36,000 (APPROVED), Ibrahim ₦9,000 (APPROVED), Funke ₦24,000 (DISPUTED). Net = gross − 5% WHT.

---

# API Contract v2: Hiring, Reports, Settings

## New enums
- `EmploymentType`: `FULL_TIME | PART_TIME | CONTRACT`
- `JobStatus`: `OPEN | CLOSED`
- `Stage`: `SCREENING | INTERVIEW | OFFER | HIRED | REJECTED`

## New entities (Prisma)
- **Job**: `id, title, department, location, employmentType, salaryMin (int?), salaryMax (int?), description, needsCv (bool default true), needsCover (bool default false), needsPortfolio (bool default false), closingDate, status (JobStatus default OPEN), createdById, createdAt`
- **JobApplication** (candidate): `id, jobId, name, email, phone?, stage (Stage default SCREENING), cvNote?, rating (float?), createdAt, updatedAt`
- **TaxRate**: `id, jurisdiction (e.g. "Federal", "Lagos"), category (e.g. "Services", "default"), whtRate (float), vatRate (float), active (bool default true)`
- **Category** (task categories config): `id, name, tier (Tier), defaultPayModel (PayModel), active (bool default true)`

(Settings templates can be a simple `Setting` key/value store: `Setting { key (unique), value (String/JSON) }`: used for notification/contract templates.)

## Hiring endpoints
- `GET /api/jobs` → `Job[]` augmented with `candidateCount (int)`
- `POST /api/jobs` → body (title, department, location, employmentType, salaryMin?, salaryMax?, description, needsCv?, needsCover?, needsPortfolio?, closingDate) → `201 Job`
- `GET /api/jobs/:id` → `Job` + `candidates: JobApplication[]`
- `PATCH /api/jobs/:id` → partial update (e.g. status) → `Job`
- `GET /api/candidates?jobId=` → `JobApplication[]` joined with `job {id,title}`. The frontend groups these into a kanban by `stage`.
- `POST /api/candidates` → body (jobId, name, email, phone?, cvNote?) → `201 JobApplication` (stage SCREENING)
- `POST /api/candidates/:id/move` → body `{stage: Stage}` → `JobApplication`; writes AuditLog (`"candidate.move"`). (This is where status-emails would fire: model only.)

## Reports endpoints
- `GET /api/reports/summary` →
```json
{
  "spendByMonth": [{"month":"Jan","spend":1200000},{"month":"Feb","spend":1450000}, ... up to 6 months],
  "spendByCategory": [{"label":"Dispatch","amount":540000,"pct":31}, ...],
  "spendByDepartment": [{"label":"Logistics","amount":680000}, ...],
  "tax": {"whtCollected": 124300, "vatCollected": 0, "remittedToFirs": 124300},
  "fillRateTrend": [{"month":"Jan","rate":74}, ...],
  "payrollEquivalent": {"grossPaid": 2486000, "totalWht": 124300, "netPaid": 2361700, "workersPaid": 38},
  "topCategories": [{"label":"Promo","tasks":18,"spend":540000}, ...]
}
```
Compute `tax.whtCollected`, `payrollEquivalent`, and `spendByCategory` from real Payment rows (status RELEASED + APPROVED). Monthly/trend arrays may be illustrative if history is thin: return at least the current month from real data.

## Settings endpoints
- `GET /api/settings/tax-rates` → `TaxRate[]`
- `POST /api/settings/tax-rates` → create → `201 TaxRate`
- `PATCH /api/settings/tax-rates/:id` → update (whtRate, vatRate, active) → `TaxRate`
- `GET /api/settings/categories` → `Category[]`
- `POST /api/settings/categories` → create → `201 Category`
- `PATCH /api/settings/categories/:id` → update → `Category`
- `GET /api/settings/templates` → `{key,value}[]` (notification/contract templates)
- `PUT /api/settings/templates/:key` → body `{value}` → `{key,value}`

All v2 mutating routes require auth; tax-rate / category / template writes require role SUPER_ADMIN.

## v2 seed data
- **Jobs**: "Operations Associate" (Logistics, FULL_TIME, ₦250k–₦400k), "Field Marketing Lead" (Marketing, FULL_TIME, ₦350k–₦500k), "Customer Support (Remote)" (Support, PART_TIME, ₦120k–₦180k).
- **Candidates** (spread across stages): ~8 across the 3 jobs: e.g. SCREENING×3, INTERVIEW×2, OFFER×1, HIRED×1, REJECTED×1, with Nigerian names.
- **TaxRates**: Federal · Services · WHT 5% · VAT 7.5% (active); Lagos · default · WHT 5% · VAT 0% (active).
- **Categories**: Dispatch (DISPATCH, HOURLY), Promo (PROMO, FIXED), Remote (REMOTE, HOURLY), Trade (TRADE, FIXED), Student (STUDENT, HOURLY): all active.
- **Templates**: keys `contract.default`, `notify.application_approved`, `notify.payment_available` with short placeholder strings.

---

# API Contract v3: Worker-facing endpoints (mobile app)

All routes here are **worker-scoped**: `requireAuth`, and the acting worker is the JWT subject (`req.user.sub`). Never trust a workerId from the body for "me" data. The mobile app logs in via the existing `POST /api/auth/login` (seeded workers: `<first>.<last>@afrizone.work` / `worker123`).

## New enums
- `ClockType`: `IN | OUT`
- `WithdrawalStatus`: `PROCESSING | PAID`
- `ContractStatus`: `PENDING_SIGNATURE | SIGNED`

## New entities (Prisma)
- **ClockEvent**: `id, workerId, taskId, type (ClockType), lat (float?), lng (float?), withinFence (bool), note?, createdAt`
- **Withdrawal**: `id, workerId, amount (int), bankMasked (string), status (WithdrawalStatus default PROCESSING), createdAt`
- **Contract**: `id, taskId, workerId, status (ContractStatus default PENDING_SIGNATURE), signedAt (DateTime?), createdAt`

## Profile & tasks
- `GET /api/me` → the authed worker: `{id,name,email,tiers (string[]),kycStatus,location?,bankMasked?,rating,completedCount}`
- `GET /api/me/applications` → worker's applications, each joined with `task` summary `{id,title,category,tier,payModel,rate,budget,status,address,locationType,startDate,endDate}` and `status`. The app buckets these: **Applied** = APPLIED, **Active** = APPROVED (+ task not CLOSED), **Completed** = task CLOSED/ARCHIVED.
- `POST /api/applications` → body `{taskId, pitch?}` (worker apply). Guards (return 400/409 with `{error}`): task must exist & be OPEN, deadline not passed, worker's `tiers` must include `task.tier`, no duplicate application by this worker for this task. → `201 Application`.

## Clock in/out (field tasks)
- `POST /api/clock` → body `{taskId, type:"IN"|"OUT", lat?, lng?}`. Compute `withinFence`: if the task is PHYSICAL and lat/lng given, true when within `task.geofenceRadius` metres of the task location (you may store task lat/lng on Task or treat any provided coords as in-fence for the demo: document the choice). Persist a ClockEvent. → `{event, clockedIn: boolean, elapsedSeconds}` where clockedIn reflects the latest event for that task.
- `GET /api/me/clock/:taskId` → `{clockedIn, lastEventAt, elapsedSeconds}` for resuming the active-task screen.

## Timesheets (worker submit)
- `POST /api/timesheets` → body `{taskId, periodStart, periodEnd, hours}` → creates a **SUBMITTED** timesheet for the authed worker → `201`. (Admin approval already exists at `POST /api/timesheets/:id/approve`, which generates the Payment.)

## Wallet
- `GET /api/me/wallet` → `{pending, available, withdrawn}` (same derivation as worker detail; `withdrawn` = Σ Withdrawal.amount).
- `GET /api/me/transactions` → merged, newest-first: earnings + withdrawals as `{id, kind:"earning"|"withdrawal", title, amount (int), status, createdAt}` (earning title = task title; withdrawal title = "Withdrawal to <bankMasked>").
- `POST /api/wallet/withdraw` → body `{amount}`. Guards: `amount` integer, ≥ ₦5,000 min, ≤ available. Creates a Withdrawal (PROCESSING) using the worker's `bankMasked`. → `201 Withdrawal`. (T+1 settlement is modelled, not real.)

## Contracts
- `GET /api/me/contracts` → worker's contracts joined with `task {id,title}`, `{id,status,signedAt,task}`.
- `POST /api/contracts/:id/sign` → marks SIGNED + `signedAt` (must belong to the authed worker) → `Contract`.
- **Tie-in:** when an admin approves an application (`POST /api/applications/:id/approve`), also auto-create a `Contract` (PENDING_SIGNATURE) for that worker+task if none exists. "Active" in the app = approved **and** contract SIGNED.

## KYC (worker submit: demo-simple)
- `POST /api/me/kyc/submit` → body `{tin?, bankMasked?, tier?}`. Stores provided fields; if `tier` given and not already present, append to `tiers`. Sets `kycStatus = PENDING`. → updated `GET /api/me` shape. (Admin still finalises via `POST /api/workers/:id/kyc`.)

## v3 seed additions (so the mobile app shows real data on first run)
Give **Amaka Obi** a live worker journey: an **APPROVED** application on "Weekend mall activation: Ikeja" with a **PENDING_SIGNATURE** Contract; an **APPLIED** application on another task; one **IN** ClockEvent (within fence) on an active task; one **SUBMITTED** timesheet; keep her existing ₦18,000 APPROVED Payment; and one example **Withdrawal** (₦10,000, PROCESSING). Other workers can stay as-is.

---

# Payments provider: Paystack Transfers (payouts)

Env-driven. `PAYSTACK_SECRET` blank → **SIMULATED** mode (no money moves, withdrawals stay PROCESSING). Set the secret → **LIVE**: withdrawal creates a Paystack transfer recipient + initiates a transfer; the webhook settles it.

- `WithdrawalStatus` now `PROCESSING | PAID | FAILED`.
- `Withdrawal` gains `provider ("paystack"|"simulated")`, `reference` (our idempotency key), `providerRef` (Paystack transfer_code), `failureReason?`.
- `User` gains `bankAccountNumber?`, `bankCode?`, `bankName?` (required for live transfers; demo NUBAN seeded on Amaka).
- `POST /api/wallet/withdraw`: unchanged request `{amount}`. In live mode without payout bank details → `400`. On provider error → withdrawal FAILED + `502`. Otherwise `201` Withdrawal (PROCESSING; `simulated:true` flag in sim mode).
- `POST /api/webhooks/paystack`: verifies `x-paystack-signature` (HMAC-SHA512 over raw body); on `transfer.success` → PAID, on `transfer.failed`/`transfer.reversed` → FAILED. Always `200`. Set this URL in the Paystack dashboard (use an ngrok/tunnel in dev).
- `POST /api/wallet/dev/settle`: **dev only** (sim mode): flips the caller's PROCESSING withdrawals to PAID so the full flow can be demoed without webhooks. Returns `403` when live.

# Platform funding (Paystack inbound: Afrizone Mart funding the wallet)

Env-driven, same `PAYSTACK_SECRET` gate as payouts. `PAYSTACK_SECRET` blank → **SIMULATED** (no real charge, `Funding` stays PENDING). Set the secret → **LIVE**: admin gets redirected to a real Paystack hosted-checkout page; the webhook settles it. Informational only for now: the platform balance is not used to gate withdrawal approval.

- `Funding` model: `id, amount, status (PENDING|SUCCESS|FAILED), provider ("paystack"|"simulated"), reference, providerRef?, initiatedBy, createdAt`.
- Platform balance is derived, not stored: `Σ SUCCESS Funding.amount − Σ non-failed Withdrawal.amount`.
- `GET /api/admin/funding/balance` (SUPER_ADMIN) → `{balance}`.
- `GET /api/admin/funding` (SUPER_ADMIN) → funding history, newest first, with `admin {id, name}`.
- `POST /api/admin/funding/initialize` (SUPER_ADMIN): body `{amount}`. Creates a PENDING Funding row. Live mode also returns `authorizationUrl` (Paystack hosted checkout) for the admin web to redirect to; sim mode returns `{simulated: true}`.
- `POST /api/webhooks/paystack`: now also handles `charge.success`/`charge.failed`, matched by `reference` (or `providerRef`/access_code), flipping the matching `Funding` to SUCCESS/FAILED.
- `POST /api/admin/funding/dev/settle`: **dev only** (sim mode): flips all PENDING fundings to SUCCESS. Returns `403` when live.

# Contract e-signature (typed-name)

`Contract` gains `signerName?, signerIp?, signatureHash?` alongside the existing `status`/`signedAt`. Signing is a typed full-name signature (no drawn/image capture): the worker types their legal name, which is stored verbatim along with the requesting IP and a SHA-256 hash of `${contractId}:${workerId}:${signerName}:${signedAt.toISOString()}` for tamper-evidence.

- `POST /api/contracts/:id/sign`: body `{signerName}` (required, ≥2 chars after trim, else `400`). Sets `status: SIGNED`, `signedAt`, `signerName`, `signerIp`, `signatureHash`. Ownership-checked; `400` if already signed.
- The rendered "Entire Agreement" section now reads "Digitally signed by `{signerName}` on `{date}`" (falls back to the worker's profile name if `signerName` is absent, e.g. legacy contracts signed before this change).
- No admin-web contract viewer exists: out of scope for this pass.

---

# The rest of the API

Everything above is the v1-v3 record. This section is the other 94 endpoints, and
together the two cover all 148 the server actually serves.

**Written from the route files, not from memory.** Where this disagrees with
`app/server/src/routes/`, the code is right.

## Conventions that hold everywhere

**Auth is `Authorization: Bearer <jwt>`.** Tokens last 7 days and **survive a
password change** - only rotating `JWT_SECRET` evicts them.

**Two axes decide what you can reach, and they are not the same axis.** `role` is
`SUPER_ADMIN | TASK_MANAGER | HR_ADMIN | WORKER` and says whether you are
Afrizone staff. `accountType` is `INDIVIDUAL | STORE | COURIER` and says what
kind of outside party you are. A store owner is `role: WORKER`,
`accountType: STORE`. Nothing gates on `accountType` alone; membership of an
organization is what grants a store's access.

**404 is used where you might expect 403.** For any row a caller cannot address -
another business's order, a delivery that is not theirs - the answer is
`404 {"error":"Not found"}`. A 403 would confirm the row exists, which turns an
id parameter into a directory of every order on the platform. Do not "fix" this
into a 403; several routes depend on it.

**Errors are `{"error": "<sentence>"}`**, written for a person to read. Some
newer endpoints add a machine-readable `code` alongside it (see the claim route);
where a `code` exists, branch on it and show the `error`.

**Money is whole Naira integers.** There is no currency field and no kobo.

## Auth and accounts

- `POST /api/auth/register` → `{name, email, password, accountType}` →
  `201 {token, user, isNewUser: true}`. Password minimum **8 characters**.
  `409` if the email exists. This is how a store owner or courier makes an
  account; it does NOT create an organization - see below.
- `POST /api/auth/login` → `{email, password}` → `{token, user}`, or
  `{requires2fa: true, challenge}` when the account has TOTP enabled.
- `GET /api/auth/me` → `{user}`.
- `POST /api/auth/otp/request` → `{phone}` (E.164) → `200`. Rate limited: `429`.
- `POST /api/auth/otp/verify` → `{phone, code}` → `{token, user, isNewUser}`.
  `429` after too many attempts - a fresh code is required, not a retry.
- `POST /api/auth/2fa/setup` (auth) → `{otpauthUrl, qrDataUrl, secret}`.
- `POST /api/auth/2fa/enable` (auth) → `{code}` → `{enabled: true}`.
- `POST /api/auth/2fa/disable` (auth) → `{code}` → `{enabled: false}`.
- `POST /api/auth/2fa/verify` → `{challenge, code}` → `{token, user}`. The
  challenge comes from the `requires2fa` login response and is short-lived.
- `POST /api/auth/google` → `{idToken}` → `{token, user, isNewUser}`.
  `503` when Google SSO is not configured; `400` "No admin account for this
  Google email" - it signs in existing admins, it does not create accounts.
- `POST /api/auth/password/forgot` → `{email}` → `200` **always**, whether or not
  the address exists. Deliberate: a different answer for an unknown address is an
  account-enumeration oracle.
- `POST /api/auth/password/reset` → `{token, password}` → `{ok: true}`. Tokens
  are single-use and expire in 30 minutes.

> **There is no change-password-while-signed-in endpoint.** Forgot-then-reset is
> the entire surface. With SMTP unconfigured the token is only visible in
> `wrangler tail`.

## A worker's own account

All under `/api/me`, all `requireAuth`, all scoped to the caller - there is no id
parameter to tamper with.

- `GET /api/me` → the caller's user. `PATCH /api/me` → name, email, phone,
  location, bank details, TIN. Account number must be **exactly 10 digits**;
  `bankMasked` is derived server-side and never trusted from the client.
- `GET /api/me/applications`, `GET /api/me/timesheets`, `GET /api/me/contracts`,
  `GET /api/me/contracts/:id` → the caller's own rows. `403` on somebody else's
  contract.
- `GET /api/me/wallet`, `GET /api/me/transactions`, `GET /api/me/payments/:id`.
- `GET /api/me/tax-statement?year=` → the annual WHT statement.
- `GET /api/me/commitments` → the escrow ring-fence from the worker's side, with
  a summary and per-item state. A null amount means hourly work whose hours are
  not in yet.
- `GET /api/me/clock/:taskId` → `{clockedIn, lastEventAt, elapsedSeconds}`.
- `GET /api/me/ratings`, `POST /api/me/ratings` → a worker rating the other side.
  Only once the work is approved.
- `POST /api/me/audits` → `{taskId, score, notes}` → files a store audit result
  for an audit task the caller holds. Score 0-100.
- `GET /api/me/notifications` → `{items, unreadCount}`;
  `GET /api/me/notifications/unread-count`;
  `POST /api/me/notifications/:id/read`; `POST /api/me/notifications/read-all`.
- `PATCH /api/me/push-token` → `{pushToken}`.
- `POST /api/me/kyc/submit` → submits for a tier.
- `GET /api/me/courier` → the courier readiness checklist plus the vehicle
  catalogue. **The catalogue travels with the answer** so no client hard-codes a
  vehicle list that then drifts from the server's.
- `PUT /api/me/courier/vehicle` → `{vehicleType, plateNumber?}`. `FOOT` and
  `BICYCLE` take no plate; a plate is unique across couriers where present.

### Skills and credentials the worker holds

- `GET /api/me/skills`; `PUT /api/me/skills` → `{skills: [{skillId, years?}]}`.
  Max 50; `years` 0-70.
- `GET /api/me/credentials`; `POST /api/me/credentials` →
  `{credentialTypeId, title, issuer?, referenceNumber?, issuedAt?, expiresAt?,
  documentId?}` → `201`. **`403` for an Afrizone-issued type** - those are
  awarded from platform history, not submitted.
- `PATCH /api/me/credentials/:id`; `DELETE /api/me/credentials/:id` → `{ok:true}`.

> **There is no `EXPIRED` status.** Expiry is computed at read time from
> `status === VERIFIED && (expiresAt is null || expiresAt > now)`, so a job that
> fails to run can never leave a lapsed licence reading as valid.

### KYC documents

- `GET /api/me/kyc/documents` → the caller's documents.
- `POST /api/me/kyc/documents` → **`multipart/form-data`**, fields `docType`
  (`ID | SELFIE | DOCS`) and `file`. Max **10 MB**. Identity types accept a
  narrower MIME list than `DOCS`.
- `GET /api/me/kyc/documents/file/:filename` → the bytes, authorized per caller.

> Both of those **bypass Express entirely** and are handled in the Worker's
> `fetch` before routing (`handleKycUpload` / `handleKycFileGet`), because
> multipart and R2 streaming do not survive the Express layer here. They are real
> endpoints; they are just not in a router.

## Organizations — a business's own people

`/api/organizations`. Access comes from `OrganizationMember`, never from `role`.
A non-member gets `404`, not `403`.

- `GET /api/organizations?kind=` → the businesses the caller belongs to.
- `GET /api/organizations/:id` → the business plus `myRole`.
- `PATCH /api/organizations/:id` → **OWNER only**. Name, contact, address,
  lat/lng, bank details, TIN. Changing the payout account writes its own audit
  row: it is the one edit here that redirects money.
- `POST /api/organizations/:id/cac` → `{cacNumber}` → **OWNER only**. Always
  lands `PENDING`, never `VERIFIED` — a registry hit is evidence, not a decision.
- `GET /api/organizations/:id/members`.
- `POST /api/organizations/:id/members` → `{email | phone, role?}` → `201`.
  **OWNER only.** The person must already have an Afrizone account (`404`
  otherwise) — this attaches an account, it does not create one.
- `PATCH /api/organizations/:id/members/:memberId` → `{role}`;
  `DELETE /api/organizations/:id/members/:memberId` → `{ok: true}`.
  Both refuse to remove or demote the **last OWNER**: a business with no owner
  cannot manage itself and needs an admin to rescue it.
- `GET /api/organizations/map?kind=&lat=&lng=&radius=` → pins, with a **named
  count of businesses the map cannot show** because nobody set their
  coordinates. Counted separately so "not approved yet" is distinguishable from
  "no location on file".

> **How a real store gets in**, since no single endpoint does it: the owner
> registers themselves (`POST /api/auth/register`, `accountType: STORE`), then an
> admin creates the organization with their address in `ownerEmail`, which
> attaches them as OWNER in the same request. A store cannot declare itself.

## Organizations — Afrizone staff

`/api/admin/organizations`, `SUPER_ADMIN | TASK_MANAGER`.

- `GET /api/admin/organizations?kind=&status=&cacStatus=`.
  `GET /api/admin/organizations/:id` → with members and the latest audit.
- `POST /api/admin/organizations` → `{name, kind?, slug?, ownerEmail?, status?, …}`
  → `201`. The owner is
  **resolved before the organization is created**, so a typo in the email cannot
  leave an ownerless business behind. `status` is `PENDING | ACTIVE | SUSPENDED`
  — there is no `APPROVED`.
- `PATCH /api/admin/organizations/:id` → including `status`, which the business's
  own PATCH cannot set.
- `POST /api/admin/organizations/:id/audit` → raises a premises-audit task. `400`
  when there is no address to send anybody to, and when it is already approved.
- `POST /api/admin/organizations/:id/audit-result` → `{score, notes}` → `201`.
  Score 0–100.
- `POST /api/admin/organizations/:id/cac-decision` →
  `{decision: VERIFIED | REJECTED, note?}`.
- `GET /api/admin/organizations/cac/config` → `{configured}`. False until
  `CAC_LOOKUP_URL` and `CAC_API_KEY` are set, which is why verification is a
  manual check today.

## Deliveries

Three audiences on one resource. See `MART_INTEGRATION.md` for the order
lifecycle and `BLUEPRINT_STATUS.md` §6 for why `Delivery.status` is a third status
axis, separate from `Task` and `Contract`.

### The store

- `GET /api/organizations/:id/deliveries?status=` → that store's orders.
- `POST /api/deliveries/:id/accept` → `{…delivery, posted: bool, warning?}`.
  **Accepting is what posts the courier job** — one action, not two, because a
  store that accepted and then had to remember a second step leaves orders
  accepted and unposted, which looks exactly like a delivery nobody wanted. If
  the posting fails the order is still accepted and `warning` says so.
- `POST /api/deliveries/:id/reject` → `{reason}` (required).
- `POST /api/deliveries/:id/prepared` → the goods are packed.

### The courier

- `GET /api/me/delivery-offers?lat=&lng=` → `{selfClaim, offers[]}`.
  Coordinates are **optional**; without them offers come back unclaimable with
  `reason: "Turn on location to take jobs near you"` rather than an invented
  distance. Each offer carries `fee`, `distance`, `claimable`, `reason`,
  `opensToYouInMinutes`, and an `offer` object
  `{stage, radiusMetres, waitingMinutes, widenings, atMaxRadius, escalated, label}`.
  **An offer carries no customer data** — no name, number or door. Somebody who
  has not taken the job has no business holding it.
- `POST /api/deliveries/:id/claim` → `{lat, lng}` → `201` with the full delivery,
  customer data now included. Refusals carry a machine-readable `code`:

  | code | status | means |
  |---|---|---|
  | `SELF_CLAIM_OFF` | 403 | `rules.DELIVERY.selfClaim` is `off` |
  | `NOT_QUALIFIED` | 403 | tier, credential or identity gate |
  | `TOO_FAR` | 403 | with `distanceMetres`, `radiusMetres`, `opensToYouInMinutes` |
  | `NO_LOCATION` | 400 | no coordinates sent |
  | `NOT_OFFERED` | 404 | not on the board |
  | `NOT_AVAILABLE` | 409 | somebody else took it |

- `GET /api/me/deliveries`; `GET /api/deliveries/:id` → `{…delivery, contractId}`
  for the courier holding it.
- `POST /api/deliveries/:id/picked-up`.
- `POST /api/deliveries/:id/complete` → `{code}`, the customer's code from Mart.
  **`503` when the verifier is unreachable** — "we could not check this", never
  "that is the wrong code". A rider must not be made to argue with a customer
  about a check that never ran.
- `POST /api/deliveries/:id/failed` → `{reason}` (required).

### Afrizone staff

`/api/admin/deliveries`, `SUPER_ADMIN | TASK_MANAGER`.

- `GET /api/admin/deliveries?status=&storeId=&stuck=&escalated=`. The response
  says whether the **outbound half of the Mart integration is configured**, so an
  operator can tell a courier problem from an unwired endpoint, and carries
  `selfClaim` and `escalatedCount`.
- `GET /api/admin/deliveries/:id` → with the task behind it.
- `POST /api/admin/deliveries/:id/cancel` → `{reason}` (required).
- `POST /api/admin/deliveries/:id/reopen` → `{reason}` → re-posts the job. §6 D5,
  the settled half: a courier who vanishes. **Reuses the same posting**, and
  restarts `offeredAt`, so
  the order is not reported as having waited since before the courier who
  abandoned it took it.
- `GET /api/admin/deliveries/purge` → what the §5 customer-data purge would do;
  `POST` runs it. Normally the `17 3 * * *` cron does this. Every run writes an
  audit row **including a run that finds nothing**, so a cron that stopped firing
  is distinguishable from a quiet week.

## Mart integration

- `POST /api/integrations/mart/events` → **not behind `requireAuth`**. Signed with
  `HMAC-SHA256(MART_INBOUND_SECRET, "<unix-seconds>.<raw body>")`, hex, in headers
  `X-Afz-Timestamp` and `X-Afz-Signature`. The timestamp is **inside** the signed
  string, not merely sent alongside it, so it cannot be changed freely. Window is
  **5 minutes**. `401` unsigned, tampered or stale; `400` for a payload understood
  and refused; `500` is ours and safe to retry, because intake is idempotent on
  `eventId`. Types: `order.confirmed`, `stock.low`, `store.applied`,
  `listing.needs_media`.
- `GET /api/admin/mart/events?status=&type=` → the ledger, with counts taken
  across everything rather than the page. This is the screen you open when an
  expected task does not exist: it distinguishes "Mart never sent it" from "we
  de-duplicated it" from "nothing handles this yet".
- `GET /api/admin/mart/rules` → `{kinds, offer}`. **Not a flat map of kinds** —
  the delivery offer rule is not a task-generation rule, and a `DELIVERY` entry
  in that list would mean something different from every other row in it.

## Staff: review, disputes, reference data

- `GET /api/credentials?filter=` → the review queue.
  `GET /api/credentials/pending-count` → `{pending}`.
  `GET /api/credentials/:id` → with the worker's other credentials for context.
  `POST /api/credentials/:id/review` →
  `{decision: APPROVE | REJECT | REVOKE, reasonCode?, reasonText?, corrections?}`.
  A rejection needs **at least 10 characters** of explanation.
- `GET /api/workers/:id/profile` → skills and credentials.
  `PATCH /api/workers/:id/tiers` → `{tiers: []}`.
  `POST /api/workers/:id/credentials` → award an Afrizone-issued credential —
  the route by which a competent worker with no formal paper can pass a gate.
  `GET /api/workers/:id/kyc/documents`.
- `POST /api/workers/:id/rate` → `{taskId, score}` (1–5) → the worker's new
  rolling rating.
- `GET /api/disputes`, `PATCH /api/disputes/:id` (staff);
  `POST /api/me/disputes`, `GET /api/me/disputes` (the worker). Raising one needs
  **10 characters** of description, and `409` if an open dispute already covers
  that item.
- `GET /api/settings/skills?all=`, `POST /api/settings/skills`,
  `PATCH /api/settings/skills/:id`, and the same three for credential types:
  `GET /api/settings/credential-types?all=`, `POST /api/settings/credential-types`,
  `PATCH /api/settings/credential-types/:id`. These are the catalogues that task
  requirements point at. `?all=1` includes retired rows;
  nothing is ever hard-deleted, only deactivated, so the rows pointing at them are
  never orphaned.
- `GET /api/settings/templates`, `PUT /api/settings/templates/:key`.
- `POST /api/tasks/qualifying-count` →
  `{tier, skillIds?, credentialTypeIds?, requiresIdentityVerified?}` → how many
  workers would qualify. Powers the live count on the task form. The denominator
  is everyone in that tier, because tier is who the work is *for*, not a
  requirement being chosen.
- `GET /api/tasks/:id/eligibility` → the caller's own verdict against one task,
  with the requirements that produced it.
- `GET /api/search?q=` → `{tasks, workers}`.

## Machines and health

- `GET /api/health` → `{status, service, time}`.
- `GET /api/health/config` → `{ready, criticalIssues, services}` — what is
  configured and what is not. The honest answer to "is anything wrong", and
  unauthenticated on purpose.
- `POST /api/webhooks/paystack` → HMAC over the raw body → `{received: true}`.
- `POST /api/webhooks/smile` → the same shape, for KYC results.

> Both webhooks and the Mart endpoint have `express.raw()` mounted on their paths
> **before** the global JSON parser. Signature verification needs the exact bytes;
> a re-serialized body will not match.

## One person, one account

Some facts should belong to one person only: the payout bank account, a government ID number, a phone (`services/identityGuard.ts`). Each is stored as an `IdentitySignal`: a SHA-256 hash with a fixed salt, never the raw value. When two or more accounts share one, an `IdentityFlag` case opens.

| Signal | Recorded when | Severity |
|---|---|---|
| `BANK` (`bankCode:accountNumber`) | `PATCH /api/me` and `POST /api/me/kyc/submit` | HIGH |
| `ID_NUMBER` | Smile ID result (sync and webhook), or the `idNumber` an admin types on `POST /api/workers/:id/kyc` | HIGH |
| `DEVICE` | `POST /api/me/device {deviceId}`, which the app sends once per session | LOW |

- **Payout hold.** A HIGH case that is OPEN or CONFIRMED pauses withdrawals for every account on it: `POST /api/wallet/withdraw` returns 403 `IDENTITY_HOLD`. Payments can still be approved and released into the in-app wallet; only money leaving the platform is stopped. LOW cases are only shown to staff.
- **Clearing.** A CLEARED case is reopened automatically if a new account joins the same value.
- **Staff** (SUPER_ADMIN, HR_ADMIN):
  - `GET /api/admin/identity-flags?status=OPEN|CLEARED|CONFIRMED|ALL` lists cases.
  - `POST /api/admin/identity-flags/:id/decide {decision: CLEARED|CONFIRMED, note}` records a decision. `note` is required.
  - `POST /api/admin/identity-flags/scan` (SUPER_ADMIN) records every saved bank account once, so accounts from before this feature are compared too.

## Selfie before a large withdrawal

- At or above Setting `payouts.selfieOver` (₦, default 100,000), `POST /api/wallet/withdraw` needs `selfieDocumentId`. That is a `PAYOUT_SELFIE` document the worker owns, uploaded in the last 15 minutes and not used before. Without one the server returns 403 `SELFIE_REQUIRED` with `selfieOver`. The app uses the front camera only, never the gallery.
- A withdrawal like this is created with status `REVIEW`. Its amount is reserved against the balance, but nothing is sent to the bank yet.
- Staff (`/api/admin/withdrawals`, SUPER_ADMIN and HR_ADMIN can read):
  - `GET ?status=REVIEW` returns each withdrawal with `payoutSelfieUrl`, the worker's latest KYC `kycSelfieUrl` and any `identityHold`.
  - `POST /:id/approve` (SUPER_ADMIN only) claims it atomically (REVIEW to PROCESSING) and sends it the same way as an ordinary withdrawal (`services/payout.ts`). It is refused while an identity case is open.
  - `POST /:id/reject {reason}` (reason required) marks it FAILED, so the money is back in the wallet, and tells the worker why.

## Opportunities

- `GET /api/opportunities?type=ALL|TASKS|HOURLY|JOBS` (any signed-in user) returns `{openTo, items}` in a single shape.
  - TASKS are open FIXED and PER_UNIT tasks; HOURLY are open hourly tasks. Tasks past their deadline are left out.
  - JOBS are open jobs.
  - Each item carries `applied`, plus `stage` for jobs, and `forYou`, which is true when it matches what the worker said they're open to on their Hiring profile. Items are newest first.
- `GET /api/opportunities/my-jobs` returns the worker's own job applications with their stage.
- **Applying for a job** (`POST /api/candidates {jobId, coverNote?, cvNote?}` as a worker): name, email and phone come from the account, never the body, and the row is linked to the worker (`userId`). The checks below run on the server:

  | Code | When |
  |---|---|
  | 403 `KYC_REQUIRED` | Identity isn't confirmed (VERIFIED or TIER_APPROVED) |
  | 400 `JOB_CLOSED` | The job is closed, or past a closing date someone actually set |
  | 409 `ALREADY_APPLIED` | Second application to the same job (also a unique index) |
  | 400 `CV_REQUIRED` | `needsCv` and no CV on the Hiring profile |
  | 400 `PORTFOLIO_REQUIRED` | `needsPortfolio` and no portfolio items |
  | 400 `COVER_REQUIRED` | `needsCover` and a cover letter under 30 characters |

  Staff can still add a candidate by hand with `{jobId, name, email}`.
- `GET /api/candidates` now includes `userId`, `coverNote` and `profile {headline, hasCv, kycStatus}`. HR opens the full Hiring profile from `userId`.
- Moving a linked candidate to INTERVIEW, OFFER, HIRED or REJECTED sends the worker a notification (`screen: "job"`).

## AI hiring helpers (Claude)

Off until the `ANTHROPIC_API_KEY` secret is set; until then these answer `503 AI_OFF`. Model `claude-opus-5-5` (override with the `AI_MODEL` var), structured outputs, server-side refusal fallbacks (`fallbacks: "default"`). Code: `services/ai.ts`.

`POST /api/me/profile/cv/read` (worker): reads the CV on their Hiring profile (PDF, JPEG, PNG or WebP; `400 NO_CV`, `415 CV_TYPE`, `413 CV_TOO_LARGE` over 10 MB) and returns `{ draft: { headline, bio, experience[], education[], skills[] } }`. **Saves nothing.** Five reads per worker per 24 h (`429 CV_READ_LIMIT`); each is audited as `cv.read`. `502 AI_FAILED` when the AI declines or can't be reached.

`POST /api/me/profile/cv/import { headline?, bio?, experience?: [...], education?: [...] }` (worker): saves what they kept, each entry through the same checks as adding it by hand. Returns `{ added: { experience, education }, skipped: [{ section, index, error }], profile }`. Audited as `cv.import`.

`POST /api/jobs/:id/shortlist { rescore?: boolean }` (SUPER_ADMIN, HR_ADMIN): scores up to 45 unscored app applicants per call against the job, from their Hiring profile and cover letter, sent **without name, email or phone** under an opaque reference. Stores `aiScore` (0-100), `aiNotes` and `aiScoredAt` on each application; returns `{ scored, remaining, error }` (press again while `remaining > 0`). `rescore` clears earlier scores first. Hand-entered candidates are not scored. A suggestion only: nobody is moved, hidden or rejected by it. `GET /api/candidates` adds `ai: { score, summary, strengths[], gaps[], scoredAt } | null`.

## Partner hiring and job alerts

AfriZone posts jobs on behalf of partner companies; partners never log in. `Job.partnerName` (null = AfriZone itself) and `Job.partnerAbout` are set on `POST /api/jobs` and `PATCH /api/jobs/:id` by HR. The feed (`GET /api/opportunities`) carries `partnerName` on job items, and their `subtitle` reads "Partner · Department".

**Consent (NDPR).** Applying to a partner job needs `consentToShare: true` in `POST /api/candidates` (else `400 CONSENT_REQUIRED`); the application records `shareConsentAt`. HR records the share with `POST /api/candidates/:id/share` (SUPER_ADMIN, HR_ADMIN): `400 NOT_PARTNER_JOB` for AfriZone jobs, `403 NO_CONSENT` without consent; sets `sharedAt`/`sharedById`, writes AuditLog `candidate.share` and tells the worker. `GET /api/candidates` adds `shareConsentAt`, `sharedAt`, `job.partnerName`; `GET /api/opportunities/my-jobs` adds `shareConsentAt`, `sharedAt`, `job.partnerName`.

`POST /api/opportunities/my-jobs/:id/withdraw` (the applicant only; `404` for anyone else): deletes the application before hiring (`400 ALREADY_HIRED` after). Returns `{ ok, alreadyShared, message }`; AuditLog `candidate.withdraw`.

**Job alerts.** `GET /api/jobs/:id/alerts?audience=MATCHING|EVERYONE` (HR) returns `{ audience, alertedAt, preview: { people, channels: { PUSH, EMAIL, SMS, WHATSAPP } }, sent: { CHANNEL: { STATUS: count } } }`. `POST /api/jobs/:id/alerts { audience }` queues one `JobAlert` row per person per channel and returns `202 { audience, people, queued }`; people already alerted on a channel, or who already applied, are skipped, so a second press sends no one twice. `MATCHING` = workers whose Hiring profile "open to" fits the job, plus those who haven't said. The per-minute cron sends a batch each run (push 100, email 100 via Resend's batch API, SMS and WhatsApp 20 each); rows end `SENT`, `FAILED` (with `error`) or `SKIPPED` when the channel isn't configured.

Channels follow `User.jobAlertEmail` (default on), `jobAlertSms`, `jobAlertWhatsapp` (default off), read and set through `GET`/`PATCH /api/me`. Push always goes as an inbox record; the push itself follows `notifTasks`. Placeholder emails (`*.local`) are never mailed.

Config: `RESEND_API_KEY` (secret) turns email on, `EMAIL_FROM` overrides the sender (default `AfriZone Jobs <jobs@afrizonemart.com>`); `TERMII_WHATSAPP_FROM` (an approved Termii WhatsApp sender) turns WhatsApp on; SMS uses the existing Termii setup.

## Talent Profile

The worker's shareable hiring profile. Proven and claimed are kept apart: work history, education, portfolio and skills are self-declared. Credentials count only once VERIFIED. `workRecord` is computed from RELEASED payments and can't be typed in.

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/api/me/profile` | worker | Full profile, including CV and portfolio files |
| PATCH | `/api/me/profile` | worker | `{headline?, bio?, location?, openTo?: ("TASKS"\|"HOURLY"\|"CONTRACT"\|"FULL_TIME")[], cvDocumentId?, visibility?: "PRIVATE"\|"LINK"}`. The first switch to LINK mints `slug`, which is never reassigned |
| POST / PATCH / DELETE | `/api/me/experience[/:id]` | worker | `{title, company, location?, startDate, endDate? (null = current), description?}` |
| POST / PATCH / DELETE | `/api/me/education[/:id]` | worker | `{institution, qualification, field?, startYear?, endYear?}` |
| POST / PATCH / DELETE | `/api/me/portfolio[/:id]` | worker | `{title, description?, url? (http/https), documentId?}`, which needs a link or a file |
| GET | `/api/public/profiles/:slug` | anyone | LINK profiles only. No contact details, files, or unverified credentials. Anything else returns 404 |
| GET | `/api/workers/:id/profile` | staff | Existing payload plus `talent` (staff cut: contact details and files) |

Files (CV, portfolio) upload through `POST /api/me/kyc/documents` with `docType` `CV` or `PORTFOLIO`, then get referenced by id. Every write returns the whole updated profile. A section holds at most 30 entries.

## Task builder

- **Categories are created from the task form.** `POST /api/tasks` and `PATCH /api/tasks/:id` accept any `category` of 1 to 60 characters. A name that isn't on the list yet is added to it (services/categories.ts). Matching ignores case and spacing, and the task is saved under the existing spelling.
- **Questions.** `Task.questions` is a list of `{id, label, type, required, options?}`. `type` is one of TEXT, LONG_TEXT, NUMBER, YES_NO, CHOICE (2 to 20 `options`) or LINK (http/https only). At most 15 per task. Send `questions` on create or PATCH; every task response returns it as a list.
- **Answers.** `POST /api/applications` takes `answers: {questionId: value}`. A required question left blank, or an answer of the wrong kind, gets a 400 with `code: "ANSWERS_INVALID"` and the question in the message. Answers to questions the task doesn't ask are dropped. The stored answers (`[{id, label, type, answer}]`) keep the wording the applicant saw. They are returned by `GET /api/applications`.
- **Templates** (SUPER_ADMIN, TASK_MANAGER): `GET/POST /api/task-templates`, `PATCH/DELETE /api/task-templates/:id`. A template is `{name, payload}`, where `payload` holds only the task form's fields (TEMPLATE_KEYS); anything else is dropped. Delete archives it. A task is never created from a template directly: the form fills in from it and then goes through `POST /api/tasks`.

## Proof-to-pay

- **Pay per unit.** `payModel: "PER_UNIT"` with `rate` = ₦ per unit (required), `unitLabel` (required, ≤30, e.g. "photo") and `maxUnits` (optional, the most one person may hand in). Committed amounts stay null until approval, as for hourly work.
- **What "done" means**, on the task: `acceptanceCriteria` (up to 10 sentences) and `proofPhotos` (0 to 10 photos of the finished work, WORK stage). Photos asked for this way don't require a signature; signatures stay tied to the task kind's own handovers.
- **Hand-in** (`POST /api/timesheets`): PER_UNIT needs `units` (1 to `maxUnits`), and `hours` is optional; other pay models need `hours` as before. An optional `note` can be added (≤1000).
  - 409 `AWAITING_REVIEW` while an earlier hand-in is still waiting.
  - 409 `ALREADY_DECIDED` once the contract is VERIFIED, PAID, CLOSED, CANCELLED or DISPUTED.
  - A CLAIMED or REWORK contract passes through IN_PROGRESS on its way to SUBMITTED.
- **Approve** (`POST /api/timesheets/:id/approve`) takes `{checks, acceptedUnits?, note?}`.
  - `checks` must include every acceptance criterion, as worded; otherwise 400 `CHECKS_INCOMPLETE` with an `unconfirmed` list.
  - PER_UNIT pays `acceptedUnits × rate`; `acceptedUnits` runs from 1 to the units handed in and defaults to all of them.
  - A FIXED task is paid once per person: a second approval gets 409 `ALREADY_PAID`.
  - Only SUBMITTED or DISPUTED work can be approved. The reviewer, the time, the checks and the note are recorded on the timesheet, and `Payment.approvedById` is set.
- **Send back** (`POST /api/timesheets/:id/rework {reason}`): `reason` is required. The timesheet becomes REWORK, the contract goes to REWORK, and the worker gets a notification with the reason. They hand in again as a new timesheet.
- **Second person for large payments.** At or above Setting `payments.secondApprovalOver` (₦ gross, default 50,000), the admin who approved the work cannot release the payment: 409 `SECOND_APPROVER_REQUIRED`. `release-all` skips those payments, reports them as `heldBack`, and now also moves each contract to PAID and marks its commitment paid, as a single release does.
- `GET /api/me/timesheets` now includes `units`, `acceptedUnits`, `note` and `reviewNote`, so the app can show why work was sent back.
