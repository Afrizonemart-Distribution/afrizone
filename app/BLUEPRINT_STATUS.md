# PartTime Blueprint v0.1 — where the build actually stands

The blueprint is the governing specification. This file reconciles it against
what exists, so nobody has to read 16 sections and 30 tables side by side to find
out what is done.

**Headline: every one of the ten things Blueprint §15 lists for Phase 1 is
built, delivery — the first item of Phase 2 — is built end to end, and a courier
can claim an order without waiting for an admin.** All of it is deployed and was
exercised against the live API on 2 September 2026; see §10. **Ranked matching
for deliveries is built and deployed** (8 October 2026; see §9). What
remains is ranked matching for other work, evidence capture and the rest of §14,
and the operational work of switching Mart on.

Three things are built to a deliberate limit, and pretending otherwise would be
the more expensive mistake: **CAC verification is a manual check** until a
registry provider is configured, **there is no map inside the apps** — the store
map is an admin screen, and a courier is handed to their own navigation app
rather than shown a pin in ours — and **a delivery cannot be completed until
Mart exposes its code-verification endpoint**, because no courier tapping a
button is allowed to produce a delivered order.

Living document. When it stops matching the code, the code is right.

---

## 1. Phase 1 (MVP), item by item

Blueprint §15 defines Phase 1 as: *Tasker + Courier + Store sign-up & KYC;
manual + basic auto task creation; contract lifecycle; wallet & escrow; map of
approved stores; two-way ratings.*

| Phase 1 item | Status | Where it stands |
|---|---|---|
| Tasker sign-up & KYC | **Built** | Phone-OTP and email sign-up, an 8-step KYC stepper, document upload to R2, Smile Identity when configured, manual admin review otherwise |
| Courier sign-up & KYC | **Built** | A readiness checklist in both the portal and the app, `CourierProfile` for the vehicle and plate, and `Vehicle insurance` as the third credential type. What is asked for follows the vehicle: nobody on foot is asked for a licence |
| Store sign-up & KYC | **Built** | `Organization`, membership, admin approval, `tin`, a premises audit raised as gated paid work (§8), and CAC registration with a four-state review. The registry lookup is env-gated: with no provider, it is a manual check and the screen says so |
| Manual task creation | **Built** | Two-step admin form with a live qualifying-worker count |
| Basic auto task creation | **Built** | One signed inbound endpoint, an event ledger, per-type de-duplication, and admin-editable generation rules. All four event types now generate; `order.confirmed` creates a delivery the store answers for |
| Contract lifecycle | **Built** | An explicit state machine — nine states and a table of legal moves, against the two it had. The blueprint names eleven; the two absent are stages this build reaches through the task, not the contract |
| Wallet | **Built** | Derived balance, withdrawals, Paystack transfers, webhook settlement |
| Escrow | **Built** | `Commitment` records the ring-fence — COMMITTED on a live contract, RELEASED on verified acceptance. Mart holds the money throughout; see §4 |
| Map of approved stores | **Built** | People → Network: a real basemap, pins by kind, click-anywhere to measure, and a count of approved businesses the map cannot show because nobody set their coordinates. Admin-facing; a courier's in-app map is delivery work, not this |
| Two-way ratings | **Built** | `Rating.direction` splits OF_WORKER from OF_EXPERIENCE, so a Tasker rates the job back and the two averages never mix |

---

## 2. What the blueprint describes that is already live

Worth knowing before anyone rebuilds it.

**Qualification gating (§3.1, §6.1) is finished.** The blueprint asks that *"the
system computes which skill roles and task tiers the verified profile unlocks"*
and that an auditor task require a verified auditor credential. That is
`services/eligibility.ts`: skills are self-declared and gate nothing, credentials
are checked by a person and do gate work, requirements are set per task, and the
worker is shown every unmet reason with a route to fix it. 24 tests.

Also live: the admin console (§3.4) with task control, KYC review, store
approvals and disputes; wallet and payout rails (§10, escrow included); audit
logging on money movement (§16); geofenced clock-in (§11); the
`Organization` model for AZM Stores (§3.3); and the `Job`/`Candidate` module,
which is the beginning of §7's hire-through-applications.

---

## 3. Six reversals the blueprint forces (two now cost nothing)

Each of these overturns a decision taken during the build. Listed with what it
costs, cheapest first.

**Store dashboard shows held AZM inventory** (§3.3, §12 `Store.held-inventory`).
Earlier direction was that Part-Time holds no stock data. *Cost: low.* It is a
read-only mirror, and the rule from `ARCHITECTURE.md` §12 applies unchanged —
display-only, decides nothing. A stale number on a screen is harmless; one that
refuses an order is a wrong refusal nobody authorised.

**The store map lives in PartTime** (§8). Earlier reasoning put a customer-facing
map on Mart's side. The blueprint's map is *operational* — visible to Couriers
and Sourcing Agents, not shoppers — which is a different thing and belongs here.
*Cost: low-medium.* Coordinates are already stored.

**Couriers are a Tasker sub-family, not a peer account type** (§3.2). The build
has three peer `accountType` values. *Cost: medium, and lower than it was.* The
courier onboarding built since keeps both readings open on purpose: it uses
`accountType: COURIER` only to decide who is SHOWN the setup screen, and what a
courier may actually do is decided by credentials through the eligibility
engine - which is account-type agnostic. So making courier-ness a skill role
later changes who sees a menu row, not who can work.

**Shared identity with AZM** (§13). The portal shipped today creates its own
accounts. *Cost: medium-high.* If identity is shared, Part-Time should have a
"continue with AfriZoneMart" button and no registration form. Blocked on AZM
exposing an identity provider.

**Escrow** (§10). *Resolved at no cost* — escrow as STATE rather than custody, see §4. Mart holds the money; PartTime records the ring-fence.

**PAPSS and AfriCOIN as payment rails** (§10). *Deferred* — Nigeria-only for now, see §4.

---

## 4. Two parameters — both now decided

### Currency: Naira only

**Decided: Nigeria-only, for now.** No currency column. `Payment.amount`,
`Task.rate`, `Task.budget` and `Withdrawal.amount` stay whole-Naira integers, and
payouts stay on Paystack NUBAN transfers. Blueprint §10 names PAPSS and AfriCOIN;
neither is in scope today.

**The trigger for revisiting is precise, and it is not a date.** The currency
column has to land *before the first non-Naira row exists in production* —
afterwards means back-filling a value that was never recorded, across every money
table at once. So the moment a second country is genuinely on the table, this is
the first schema change, not a later one.

### Escrow: state, not custody

**Decided: Mart holds the money throughout. PartTime records the commitment and
releases it on verified acceptance.**

This satisfies Blueprint §10's guarantee — *"funds ring-fenced when a contract
goes live and released only on verified acceptance"* — without PartTime ever
receiving money. The worker-facing promise is identical: their pay is ring-fenced
the moment the contract goes live. What differs is that PartTime does not become a
regulated payments business, hold a float, or reconcile a balance of its own.

Four commitment states: `COMMITTED` when the contract goes live, `RELEASED` on
verified acceptance, `PAID` when Mart confirms it paid, `CANCELLED` if the
contract fails. PartTime never asserts anything was paid — only Mart knows that.
Specified in `MART_INTEGRATION.md` §7.

---

## 5. Mart integration — specified, and now built

`MART_INTEGRATION.md` was written before this blueprint and covered only
`order.confirmed`. It has been rewritten around the event bus §5 asks for, and
that bus is now live on the PartTime side — one signed endpoint at
`POST /api/integrations/mart/events`, an event ledger, and an admin screen at
Operations → Mart. Mart itself is not sending yet.

| Blueprint event | Creates | De-duplicated on |
|---|---|---|
| `order.confirmed` | Fulfilment + dispatch | `martOrderId` |
| `stock.low` | Sourcing task | `sku` + region — one open task per product per region |
| `store.applied` | Audit task | `applicationId` |
| `listing.needs_media` | Photography task | `listingId` |

Two things came out of writing it that are worth knowing here:

**Mart sends facts, not task parameters.** No pay band, no radius, no required
skill role, no deadline. Those are PartTime's Admin-editable generation rules per
§5 — putting them in Mart's payload would mean changing Mart's code to raise a
courier fee.

**Two kinds of duplicate need different answers.** `eventId` stops the same
delivery being processed twice; a per-type de-duplication rule stops duplicate
*work*. `stock.low` firing hourly while a shelf stays empty is the case that
makes the distinction obvious, and neither mechanism substitutes for the other.

D10 in that spec — who owns the store record — **is settled: PartTime owns it.**
A `store.applied` event is Mart forwarding a lead, so the handler creates the
`Organization` itself, PENDING, and raises the audit. Mart is not handing over a
business.

**Every event is recorded, including the ones nothing could act on.**
`order.confirmed` was answered 202 and stored DEFERRED for as long as delivery
did not exist, because there was nothing correct to create. Answering 200 and
dropping it would have lost real orders. It now creates a delivery — see §6 —
and the events banked under DEFERRED are still there and still replayable.
Nothing replays them automatically, deliberately: a batch of week-old orders
landing at real shops at once is a decision somebody makes, not a side effect of
a deploy. The distinction the ledger exists for — between "Mart never sent it",
"we de-duplicated it" and "we could not place it" — is what the admin screen
shows, and it is why this is a ledger rather than a bare idempotency key.

---

## 6. Delivery — built and exercised, never against a real Mart

The first item of Phase 2, and the reason `order.confirmed` sat DEFERRED. Three
things were missing and all three now exist.

**A second location.** A task has one site; a delivery has a shop to collect from
and a door to knock on, and the distance between them is the work. The new
`Delivery` table holds both. The pickup is **copied** from the store rather than
joined to it, so a shop that moves or is renamed does not rewrite where
deliveries already made actually went.

**A progress axis that is not the courier's.** This is the decision worth
understanding before changing anything: there are now three status axes.
`Task.status` is the posting. `Contract.status` is one person's engagement with
it. `Delivery.status` is the ORDER, and it has to be separate because "the store
has not accepted this yet" is a state that exists before any courier does and can
end the order without one. Collapsing it into the courier's work lifecycle makes
*did the rider fail, or did the store refuse?* unanswerable, and those need
different people to act on them.

Packing is a **timestamp, not a state**, for the same reason `Contract.signedAt`
is one: a courier may well accept the job while the shopkeeper is still bagging
it, and a state would force an order through a sequence real shops do not
respect.

**A customer OTP for somebody with no PartTime account.** Mart generates the
code, delivers it and verifies it; PartTime never stores it and never sees it
except in transit. That removes the problem outright rather than solving it —
PartTime's own `OtpCode` model is keyed to a user, and a delivery customer has no
user.

What the flow is: Mart confirms an order → the store accepts or refuses it → an
acceptance posts a credential-gated courier job through the same generator every
other automatic task uses → a courier claims it, or an admin approves an
application, and the same code assigns them either way → the courier collects →
the courier enters the customer's code, Mart verifies it, and only then is it
delivered.

All three parties have a screen. A store answers its inbox in the portal; a
courier works their jobs in the portal and in the app, where live deliveries also
appear on the home screen because an order is the only work on this platform with
somebody standing in a doorway; operations watches a board at Operations →
Deliveries that says *who each order is waiting on* rather than only what state
it is in.

**A courier can take a delivery without waiting for anybody.** An accepted order
is offered inside a circle around the shop that widens on a timer — three
kilometres at first, doubling every five minutes to a fifteen-kilometre ceiling —
and any qualified courier standing inside it can claim it from the app. There is
still only one assignment path: self-claim and admin approval both run
`assignWorker()`, so the two can never disagree about who holds a job, and a
claim takes the posting with a conditional update, so two couriers tapping at
once produce one contract and one refusal.

Nothing about a courier's position is stored. The app sends a location with the
request and the platform forgets it, which is why the radius belongs to the
posting rather than to a query over couriers. If an order is still unclaimed
after twenty minutes it is flagged for a person on the operations board — the fee
never moves on its own, and the order stays claimable while it is flagged. Every
number is a Setting an admin edits at Mart → Delivery offer, and
`rules.DELIVERY.selfClaim = "off"` puts assignment back to approval only.

One thing is deliberately absent:

- **A delivery cannot complete until Mart exposes two endpoints.** Unconfigured,
  a courier is told *we could not check this* — never *that is the wrong code*,
  which would have them arguing with a customer about a check that never ran. The
  operations board says so at the top of the page, so an order that will not
  complete is not mistaken for a courier who has not turned up.

`MART_INTEGRATION.md` §6 D1 and D6 are open and now matter: what a courier does
when the verifier cannot be reached, and whether a failed attempt is paid. D4 —
how long an unclaimed delivery waits — is settled and built, above. D5 — a
courier who vanishes — is half-settled: an operator re-opens the posting from
the board, and how long that should take before somebody notices is still open.

**Customer data is deleted seven days after an order finishes**, per §5 — the
name, the number, the door, the coordinates and the instructions, actually
emptied rather than flagged. This is the platform's only scheduled job, and it
exists because absence of data is the one thing that cannot be derived at read
time the way expired postings and credentials are. Every run writes an audit row
including a run that finds nothing, so a cron that stopped firing is
distinguishable from a quiet week.

---

## 7. Substantial features not started

- **Ranked matching for anything but deliveries** (§11). Deliveries are done
  (§9); every other task is still apply-then-approve with no ordering.
- **Reputation tiers and badges** (§9). Note this is a *third* meaning of "tier"
  in the project — bronze/silver/gold reputation standing, distinct from both the
  work-category tiers (`STUDENT`, `DISPATCH`…) and any store tier from §14.
  Naming needs settling before it is built.
- **Surge pay, crew contracts, referral loop** (§10, §14).
- **CallyValley** as the certification feeder and **VOLTRON** as a labour
  consumer (§2). Neither system has been discussed before.
- **Offline-tolerant mobile flows** (§16). The app currently assumes
  connectivity throughout.

---

## 8. Terminology

The blueprint's vocabulary should win. The user-facing strings were switched
on 27 October 2026; the schema and code names were left alone.

| Blueprint | Code today |
|---|---|
| **PartTime** | "AfriZone PartTime" in every UI, the agreement, the WHT statement and the Paystack payout reason. Expo slug, bundle ids and domains unchanged on purpose |
| **Tasker** | "Tasker" in the mobile app, the portal and the API messages a Tasker reads ("New Tasker", "Tasker not found"). The admin console keeps "Worker" for staff, by choice. Code: `WORKER` / `INDIVIDUAL` |
| **AZM Store** | `Organization { kind: STORE }` |
| **Skill role** (Sourcing Agent, Auditor, Courier, Field & Media) | `Skill` + `Tier`, no role concept |
| **Contract** | Split across `Application`, `Contract` and `Task` |

Renaming is cheap in the UI and expensive in the schema. Worth doing the
user-facing strings early and leaving table names alone until there is a
migration touching them anyway.

---

## 9. What is next

**Phase 1 is complete, delivery is built end to end, and a courier can claim an
order themselves.** Everything below is in the order it is worth doing:

1. **Ranked matching — built for deliveries and deployed, 8 October 2026**
   (D1 migration 0021, API version `4019ad3f`, mobile build version code 5;
   the per-minute cron was seen running on the live worker). Couriers tap "Go online" and the app sends their position every
   three minutes while it is open; only the latest point is kept
   (`CourierPresence`), deleted on going offline and swept after 30 minutes of
   silence. When an order goes on the board, every online, qualified courier
   within the widest circle is scored — distance 45%, finishing what they take
   25%, rating 15%, current load 15%, with unknowns neutral so a new rider is
   not last — and the top three get it to themselves for two minutes each,
   with a push. Then it opens to the circle as before. Nobody online means no
   ranked phase at all. Both numbers are on the admin Mart page
   (`rules.DELIVERY.rankedCandidates`, `rankedWindowMinutes`; 0 turns it off).
   Whose turn it is is derived from `offeredAt` like the circle; a new
   per-minute cron only sends the "your turn" push and sweeps stale presence.
   Code: `services/ranking.ts`, `routes/presence.ts`, migration
   `0021_ranked_offers.sql`, 25 tests in `test/ranking.test.ts`.
   **Built 27 October 2026, not yet deployed:** a "Pass to the next courier"
   button (`POST /api/deliveries/:id/pass`, `passTurn` in `services/ranking.ts`).
   The unused rest of the window is stored in `Delivery.rankedSkippedSeconds`
   (migration `0023_ranked_pass.sql`) and shifts the turn clock, so whose turn
   it is stays arithmetic; escalation still reads the real time waited. The next
   candidate is told at once; the last one passing opens the circle. And
   **background location**: going online asks for "Allow all the time" and
   starts an `expo-location` background task (`src/lib/presence.ts`), which
   Android runs as a foreground service with a notification for as long as the
   rider is online; it sends the same heartbeat every three minutes and stops on
   going offline, sign-out, or a 401/403. Refusing keeps the old in-app
   heartbeat. Needs a new APK; not yet tried on a real phone.
   **Still open:** the weights are constants until there is real order data to
   tune them against. Other task kinds still have no ranking.

   What the blueprint asked for, for the record: the build gated qualified / not qualified; the
   blueprint wants candidates scored on skill, proximity, reliability and load.
   The delivery offer answers a crude version of proximity — inside the circle or
   not — and nothing orders the couriers inside it. "Who is nearest and free?" is
   the question an order asks, and until this it was first-come.
2. **Proof-of-work photos — built and deployed 9 October 2026** (D1 migration
   0022, the API, the admin console and APK version code 6). Camera-only
   photos with position and time, checked on arrival (`services/evidence.ts`):
   distance from the site, accuracy of the fix, age, phone clock. A failed
   check is a flag in words for the reviewer, never a refusal; only a missing
   photo refuses the step. Required: deliveries one at the shop before
   "collected" and one at the door before the customer code is spent; store
   audits three before the score is filed; MEDIA work and on-site SOURCING one
   before hand-in; hourly on-site work a fresh, single-use photo at each clock
   in and out. `evidence.enforce` = off switches the gate off in one row. Door
   photos are customer data and are deleted by the §5 purge; shop photos stay.
   The worker app gained the photo panel and an audit-filing form (there was
   none); the admin site shows photos, flagged first, from Timesheets,
   Deliveries and each task card. Migration `0022_evidence.sql`, 21 tests in
   `test/evidence.test.ts`. **Signatures, built 27 October 2026, not yet
   deployed:** every step that needs a photo except clocking also needs the
   other side of the handover to sign on the Tasker's phone - the shop at
   pickup, the customer at the door, the store manager on an audit, the site
   contact on field work (`signatureRequired`). Signer's typed name plus SVG
   path data (M/L/Q/C/Z and numbers only), stored in the row, not R2; same
   where-and-when flags as a photo, same `evidence.enforce` switch, refusal
   code `SIGNATURE_REQUIRED`; signing again replaces. Door signatures are
   customer data and go with the §5 purge. Migration `0024_signatures.sql`,
   `POST /api/me/evidence/signature`; shown in the admin's proof-of-work
   dialog. **Not built:** an admin screen for store audit results generally
   (photos and signatures are reviewed from the task card).
3. **Reputation tiers and badges** (§9). Note this is a *third* meaning of
   "tier"; the naming needs settling before it is built.
4. **Surge pay, crew contracts, referral loop** (§10, §14), **shared identity
   with AZM** (§13, blocked on Mart exposing an identity provider), and
   **offline-tolerant mobile flows** (§16).

Three things have a deliberate ceiling worth revisiting when there is a reason:

- **CAC verification is manual** until `CAC_LOOKUP_URL` and `CAC_API_KEY` are
  set. The lookup and the name comparison are built and dormant.
- **There is no map inside the apps, by choice.** A courier taps "Directions to
  the shop" or "Directions to the door" and is handed to Google Maps, which has
  the traffic, the one-way system, voice guidance and their offline tiles. An
  embedded map would have shown a pin; a rider does not need to be shown where
  the door is, they need to be taken there. What is still absent is at-a-glance
  context — seeing several jobs on one map before choosing — and that is a
  different job from finding a door. It would cost a map SDK, an API key and a
  billing account, and should wait until somebody asks for it.
- **A delivery cannot be completed** until `MART_BASE_URL` and
  `MART_OUTBOUND_SECRET` are set and Mart exposes the code check. Built and
  dormant, the same way the CAC lookup is.

Still needed from the Mart team before any of this carries real traffic:
agreement on `stockSource`, a staging environment, and the two outbound endpoints
in `MART_INTEGRATION.md` §4 and §5 with a secret of their own. The inbound shared
secret is half-settled — PartTime's side is set and verified, and Mart has to be
configured with the identical string or every event it sends is refused. Every
one of those refusals is the intended behaviour rather than a fault to debug.

---

## 10. What is actually running in production

A separate axis from everything above. The rest of this file reconciles the
blueprint against the code; this section reconciles the code against what is
deployed, because those drift apart in a way that is invisible from the repo and
expensive to guess at. Verified 23 October 2026 against the live account and
database rather than against documentation — see the warning about `README.md`
below for why that distinction is not pedantry.

**Everything described in this document is deployed** (verified 27 October
2026). D1 is at migration `0023_ranked_pass.sql`; the API worker is version
`bf46417c-7d72-4594-bda4-5992ecf29318`, deployed 27 October 11:03 UTC from the
working tree that became the pass and background-location commits; the live
`/api/deliveries/:id/pass` answers 401, not 404. A deploy ten minutes earlier,
`c65bce3b`, carried the rename and possibly part of the pass work, so it is
not a clean rollback target. Roll back to `21342ee0-788b-40d7-9211-0a6a8136af47`
(8 October, `25a9dca`): migration 0023 only adds a column with a default, so
the database is fine with it. The admin console and the portal were both
uploaded by hand from `7d497f8` the same morning.

History: `21342ee0` was deployed 8 October 22:52 UTC, four minutes after
`25a9dca`. The deploy before it, `6b3e171c` (22:51), also
postdates that commit and almost certainly carries the photo code too, so the
rollback target from before photos is `10e6c453-6b8c-4d2e-b099-c771ef126e76`
(22:29, after `a043caf`); migration 0022 only adds, so rolling back to it
leaves the database fine; `/api/me/evidence` answers 401 on the live API, not 404.
The admin console's production deployment on Pages is built from `25a9dca`,
and the live bundle carries the evidence screens. The nightly customer-data purge from §5 is registered as
`17 3 * * *`.

**`README.md` is wrong about how the API deploys.** It claims Workers Builds
auto-deploys `app/server` on a push to `main`. It does not, and never has —
Workers Builds lists zero builds for this Worker and the account reports its last
deploy came from `wrangler`. **`app/server` must be deployed by hand with
`npx wrangler deploy`, and it must go BEFORE the push**, or the admin console
rebuilds against an API that has not learned the routes it is about to call.
`app/web-admin` is the opposite: GitHub-connected, so pushing is the deploy and
deploying by hand is wrong. `app/web-portal` is direct-upload only.
**As of 27 October 2026 that connection is broken:** the Pages project still
points at `allianewase/afrizone`, which moved to `Afrizonemart-Distribution`,
so pushes to `main` build nothing (none for `211a241`). Reconnect it in the
dashboard (Settings → Builds → Git repository) before trusting a push.

**`app/mobile` ships as a sideloaded APK, not through a store.** The current
build being made is EAS `613be38a` (version code 9, started 27 October 2026
from the working tree on `7d497f8`: the rename, the pass button and background
location); `cc69db2a` (version code 8) is a duplicate of the same run. Until
it is installed and checked on a phone, the last build known to work is
EAS `ebafdda6` (`preview` profile, version code 7), made from
`25a9dca` on 23 October 2026 and pointed at the live API; its download link
expires 6 November 2026. It is the same code as version code 6 (EAS
`aa909456`, 8 October), rebuilt only because that build's link expired after
two weeks. Version code 4 was installed and opened on a real Android phone on
8 October. **The courier's self-claim screen
is therefore in a rider's hands**, but only for whoever has been sent the APK
link, and nobody gets updates automatically: each new build means sending a
new link. The link is an EAS artifact, which does not last forever. There is
no Play Store listing and no iOS build.

**Secrets on the worker are `JWT_SECRET`, `TERMII_API_KEY` and
`MART_INBOUND_SECRET`.** The inbound secret was set and verified on 2 September:
a tampered signature is refused, a timestamp older than the five-minute window is
refused, and a correctly signed event reaches the domain. `MART_BASE_URL` and
`MART_OUTBOUND_SECRET` are still unset, so the completion refusal in §6 is live
behaviour today, not a hypothetical.

**There are no `rules.DELIVERY.*` rows in `Setting`**, so every offer number is
its code default — 3 km, doubling every five minutes, 15 km ceiling, escalation
at twenty. An empty table here is the configured state, not a migration that
half-ran.

**Delivery was proven end to end against the live API**, using a throwaway store
and courier that have since been deleted: a signed `order.confirmed` created the
order, the store accepted it, the posting appeared in the courier's offers, and
the claim moved `Task` to FILLED, `Contract` to CLAIMED and `Delivery` to
COURIER_ASSIGNED with the eligibility snapshot frozen. The refusals behaved —
too far, no location, already taken. **Widening was observed on live data;
escalation was not.** The unclaimed order reached nine minutes and one doubling
before the test data was removed, so the twenty-minute escalation is proven by
the test suite alone.

**The database holds no stores and no orders** — five users, two tasks, one
contract. That is the real remaining blocker, and it is not a code one:
`order.confirmed` resolves `fulfilment.storeSlug` against `Organization`, so
until a real store exists on this side, every order Mart sends is refused with
`No store with slug`. The feature is live and inert, and both halves of that
sentence are deliberate.
