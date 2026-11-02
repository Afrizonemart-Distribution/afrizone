# Continue with AfriZone: one account for Part-Time

**Status:** the AfriZone side is built (afrizonemart-api #177) and
switched off until its signing key is set. The Part-Time side below is a proposal
for whoever owns this repo, and nothing here is built yet. It closes the
"Shared identity with AZM (§13), blocked on AZM exposing an identity provider"
item in `BLUEPRINT_STATUS.md`.

Decision (Magnus, 2026-11-02): Part-Time joins the one AfriZone Account now,
like the storefront, Ink, the supplier portal and the HUD. A person signs in
once with the same email, password, Google and 2FA everywhere.

## 1. What stays where

| Thing | Owner |
|---|---|
| Who the person is: email, name, verified phone, country, password, Google, 2FA | **AfriZone Account** (afrizonemart-api) |
| Part-Time roles, tiers, KYC, wallet, bank, tasks, standing | **Part-Time**, unchanged |
| Part-Time sessions (its own JWT) | **Part-Time**, unchanged |

Part-Time keeps its own `User` rows and sessions. It adds a link to the AfriZone
account and lets that account sign in. Nothing in the Part-Time data model moves.

## 2. The flow

```
App (web or mobile)                AfriZone API                    Part-Time API
 1. sign in to AfriZone  ───────▶  POST /api/auth/login (or Google/phone)
                                    └─ 2FA on? { mfaRequired, mfaToken } → POST /api/auth/mfa/sign-in
                         ◀───────  { user, accessToken }
 2. ask for an identity token ───▶  POST /api/auth/identity-token  { audience: "parttime" }
                                    Authorization: Bearer <accessToken>
                         ◀───────  { identityToken, expiresInSeconds: 300 }
 3. hand it to Part-Time  ───────────────────────────────────────▶  POST /api/auth/afrizone { identityToken }
                                                                     verify (§3) → link or create (§4)
                         ◀───────────────────────────────────────  { token, user, isNewUser }   (Part-Time session)
```

- **Web** (admin/portal on `*.parttime.afrizonemart.com`): the AfriZone refresh cookie
  is scoped to `.afrizonemart.com`, so someone already signed in to afrizonemart.com
  can skip step 1. Call `POST https://api.afrizonemart.com/api/auth/refresh` with
  `credentials: "include"` and use the returned `accessToken`. This needs the
  Part-Time origins in the AfriZone API's `CORS_ORIGINS`; ask Magnus.
- **Mobile**: show an AfriZone sign-in screen (email + password, Google; then the
  6-digit 2FA step when the API answers `mfaRequired`), or open
  `https://afrizonemart.com/login` in an auth session. Then do steps 2–3.

## 3. Verifying the identity token (Part-Time server)

ES256 JWT, 5-minute life, one audience. The public key is at
`https://api.afrizonemart.com/.well-known/jwks.json`. The simplest setup is to put
the PEM in an env var (`AFRIZONE_IDENTITY_PUBLIC_KEY`); fetching the JWKS lets the
key rotate without a deploy.

```ts
import jwt from "jsonwebtoken";

const claims = jwt.verify(identityToken, AFRIZONE_IDENTITY_PUBLIC_KEY, {
  algorithms: ["ES256"],          // never accept HS256 or "none" here
  issuer: "afrizonemart",
  audience: "parttime",
}) as AfrizoneClaims;
```

Claims (OIDC names, so a later move to a full OIDC provider is a drop-in):

| Claim | Meaning |
|---|---|
| `sub` | AfriZone user id. **The only thing to link on long-term.** |
| `email`, `email_verified` | `email` is `null` for phone-only accounts |
| `name` | may be `null` |
| `phone_number`, `phone_number_verified` | `phone_number_verified` is always `false` for now: AfriZone doesn't yet record when a phone was verified. Show the phone, never link on it |
| `country` | ISO-2, any country, may be `null` |
| `mfa_enabled` | the account has 2FA on |
| `jti`, `exp` | store used `jti`s until `exp` so a token can't be replayed |

## 4. Linking rules (security-critical)

Add `afrizoneUserId String? @unique` to `User` (one D1 migration).

1. A user with `afrizoneUserId = sub` exists: sign them in.
2. Otherwise, if `email_verified` and a **WORKER** with that email exists, link it
   (set `afrizoneUserId`) and sign in. **Don't link by phone**: an AfriZone user can
   type any number into their profile, so a phone match proves nothing. Phone
   linking can come once AfriZone sends `phone_number_verified: true`, which it
   only will after it records verified phones.
3. **Never auto-link a staff account** (SUPER_ADMIN, TASK_MANAGER, HR_ADMIN). A staff
   member links from Settings while signed in to Part-Time, which proves they own
   both accounts. Otherwise anyone who controls a matching AfriZone email could
   take over an admin.
4. Nothing matches: create a WORKER (`kycStatus PENDING`) with `name`, `email`, `phone`,
   then go to the KYC stepper (`isNewUser: true`).
5. Write an `AuditLog` row for every link and every account created this way.

## 5. 2FA

AfriZone requires 2FA for its staff and earners from **14 Nov 2026**, and every
AfriZone sign-in already asks for the code when it's on. For Part-Time:

- **Workers** signing in this way have passed AfriZone's sign-in, including 2FA if
  they turned it on.
- **Staff** should keep Part-Time's mandatory TOTP for now. The identity token says
  whether the account has 2FA (`mfa_enabled`), not whether this sign-in used it.
  An `amr` claim can be added on the AfriZone side if Part-Time wants to rely on it.

## 6. Rollout

1. AfriZone: merge afrizonemart-api #177, set `IDENTITY_SIGNING_KEY` on Railway,
   and add the Part-Time origins to `CORS_ORIGINS`.
2. Part-Time: build §3–4 behind an env flag and add the **Continue with AfriZone**
   button next to the existing sign-in options.
3. Run both sign-ins side by side; existing accounts with the same verified email link the first
   time their owner uses the button; phone-only workers link from Settings.
4. Then make Continue with AfriZone the only sign-up path and keep phone OTP only
   for linked accounts, so there's no separate Part-Time registration form (§13).

## 7. Not in scope here

- Moving Part-Time KYC onto AfriZone account levels (Level 2 NIN/BVN). That comes
  when AfriZone KYC exists; until then Part-Time's own KYC stands.
- A full OIDC provider at `accounts.afrizonemart.com`. That's planned later, and the
  claims above are chosen so this flow moves onto it unchanged.
