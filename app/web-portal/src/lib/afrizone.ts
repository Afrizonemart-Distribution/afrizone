/**
 * Continue with AfriZone (app/AFRIZONE_ACCOUNT.md §2, web flow).
 *
 *   1. Get an AfriZone access token. The AfriZone refresh cookie is scoped to
 *      .afrizonemart.com, so someone already signed in on afrizonemart.com
 *      gets one straight from POST /api/auth/refresh. If not, AfriZone's own
 *      sign-in opens in a popup (its login page only redirects within its own
 *      site, by design) and we wait for the cookie to appear.
 *   2. Swap it for a 5-minute identity token for audience "parttime".
 *   3. Hand that to OUR server, which verifies it and returns a Part-Time session.
 *
 * The AfriZone access token never leaves this function and is never stored:
 * Part-Time only ever holds its own session.
 */

const AFRIZONE_API = import.meta.env.VITE_AFRIZONE_API_URL ?? 'https://api.afrizonemart.com'
const AFRIZONE_LOGIN = import.meta.env.VITE_AFRIZONE_LOGIN_URL ?? 'https://afrizonemart.com/login'

const POLL_MS = 2000
const POPUP_TIMEOUT_MS = 5 * 60 * 1000

/** An AfriZone access token if the shared cookie holds a session, else null. */
async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await fetch(`${AFRIZONE_API}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
    if (!res.ok) return null
    const body = (await res.json()) as { accessToken?: string }
    return body.accessToken ?? null
  } catch {
    return null
  }
}

/**
 * Open AfriZone sign-in and wait until it has set the session cookie.
 * Must be called from a click handler (synchronously opens the popup).
 */
function waitForAfrizoneSignIn(popup: Window | null): Promise<string> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    let stopped = false
    const stop = () => {
      stopped = true
      clearInterval(timer)
    }
    const timer = setInterval(async () => {
      if (stopped) return
      const token = await refreshAccessToken()
      if (stopped) return
      if (token) {
        stop()
        try {
          popup?.close()
        } catch {
          /* already gone */
        }
        resolve(token)
      } else if (!popup || popup.closed) {
        stop()
        reject(new Error('AfriZone sign-in was closed before it finished.'))
      } else if (Date.now() - started > POPUP_TIMEOUT_MS) {
        stop()
        reject(new Error('AfriZone sign-in timed out. Please try again.'))
      }
    }, POLL_MS)
  })
}

/**
 * Steps 1-2. Call straight from a click handler: the popup has to open in the
 * same tick as the click or browsers block it.
 */
export async function getAfrizoneIdentityToken(): Promise<string> {
  // Open first, synchronously. If they turn out to be signed in already we
  // close it again a moment later, which beats a popup blocker eating it.
  const popup = window.open(AFRIZONE_LOGIN, 'afrizone-signin', 'width=480,height=720')

  let accessToken = await refreshAccessToken()
  if (accessToken) {
    popup?.close()
  } else {
    if (!popup) {
      throw new Error('Allow pop-ups for this site, then try Continue with AfriZone again.')
    }
    accessToken = await waitForAfrizoneSignIn(popup)
  }

  const res = await fetch(`${AFRIZONE_API}/api/auth/identity-token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ audience: 'parttime' }),
  })
  if (!res.ok) {
    throw new Error(
      res.status === 503
        ? 'Continue with AfriZone is not available yet.'
        : 'AfriZone could not confirm your sign-in. Please try again.',
    )
  }
  const { identityToken } = (await res.json()) as { identityToken?: string }
  if (!identityToken) throw new Error('AfriZone could not confirm your sign-in. Please try again.')
  return identityToken
}
