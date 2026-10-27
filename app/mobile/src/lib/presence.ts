/**
 * Going online for ranked delivery offers (server: services/ranking.ts).
 *
 * A courier who is online is offered orders first when they are among the
 * best-placed riders for the shop. That needs the server to know roughly where
 * they are before they ask, so while they are online the app sends their
 * position every few minutes. Only the latest point is kept, and going offline
 * deletes it.
 *
 * ONLINE MEANS ONLINE WITH THE APP CLOSED, IF THE RIDER ALLOWS IT. A rider puts
 * the phone in their pocket and rides; a heartbeat that only ran while the app
 * was open dropped them off the ranking 30 minutes later, exactly when they
 * were waiting for work. So going online asks for "Allow all the time"
 * location and starts a background task, which Android runs as a foreground
 * service with a notification that stays up while they are online - the rider
 * can always see that they are being located, and why. Going offline, signing
 * out, or the server saying they are offline stops it.
 *
 * REFUSING IS NOT A FAILURE. A rider who keeps location to "while using the
 * app" is still online; the in-app heartbeat below keeps them ranked while the
 * app is open, which is how this worked before, and the server's 30-minute
 * timeout takes them off when they put it away.
 *
 * ONE SHARED FLAG, NOT PER-SCREEN STATE. The Deliveries toggle and the
 * heartbeat in the root layout must agree about whether this courier is online,
 * and a module-level store is the smallest thing that lets them.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { api, ApiError } from '../api/client';

/** Well inside the server's 30-minute timeout, so one missed beat costs nothing. */
const HEARTBEAT_MS = 3 * 60_000;

/** The background task's name. Registered once, below, at module load. */
const PRESENCE_TASK = 'afrizone-courier-presence';

type Listener = () => void;
let online: boolean | null = null; // null: not yet asked the server
let background = false; // whether the background task is running
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

function setOnline(next: boolean | null) {
  online = next;
  emit();
}

function setBackground(next: boolean) {
  background = next;
  emit();
}

function subscribe(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Whether this courier is online, as the app last heard from the server. */
export function usePresence(): boolean | null {
  return useSyncExternalStore(subscribe, () => online);
}

/** Whether being online carries on with the app closed. */
export function useBackgroundPresence(): boolean {
  return useSyncExternalStore(subscribe, () => background);
}

// ── The background task ──────────────────────────────────────────────────────

/*
 * Defined at module scope because Android may start the JS runtime for this
 * task alone, with no screen mounted; the definition has to exist by the time
 * the root layout's imports have run.
 *
 * Every delivery from the OS is a heartbeat, which is fine: the OS is asked for
 * one every three minutes, and the server only keeps the latest point.
 */
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(PRESENCE_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const last = data.locations[data.locations.length - 1];
  try {
    const res = await api.goOnline({ lat: last.coords.latitude, lng: last.coords.longitude });
    // Offline on the server - from another device, or by staff - means stop
    // locating them. A notification saying "online" that is not true is worse
    // than none.
    if (!res.online) await stopBackground();
  } catch (e) {
    // Signed out, or the account can no longer go online. A network blip is
    // neither, and the next beat will try again.
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) await stopBackground();
  }
});

/**
 * Start the background task, asking for "Allow all the time" only when `ask`
 * is set - that is, when the rider has just tapped Go online. Returns whether it
 * is running. Never throws: a phone that will not do this is a rider on the
 * in-app heartbeat, not an error.
 */
async function startBackground(ask: boolean): Promise<boolean> {
  try {
    const current = await Location.getBackgroundPermissionsAsync();
    let granted = current.status === 'granted';
    if (!granted && ask && current.canAskAgain) {
      granted = (await Location.requestBackgroundPermissionsAsync()).status === 'granted';
    }
    if (!granted) {
      setBackground(false);
      return false;
    }
    if (!(await Location.hasStartedLocationUpdatesAsync(PRESENCE_TASK))) {
      await Location.startLocationUpdatesAsync(PRESENCE_TASK, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: HEARTBEAT_MS,
        deferredUpdatesInterval: HEARTBEAT_MS,
        distanceInterval: 0,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'You are online for deliveries',
          notificationBody: 'Sharing your location so orders near you come to you first. Go offline in the app to stop.',
          notificationColor: '#C2502E',
        },
      });
    }
    setBackground(true);
    return true;
  } catch {
    setBackground(false);
    return false;
  }
}

/** Exported for sign-out, which must stop locating whoever was signed in. */
export async function stopBackground(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(PRESENCE_TASK)) {
      await Location.stopLocationUpdatesAsync(PRESENCE_TASK);
    }
  } catch {
    // Not running, or the task was never registered on this build.
  }
  setBackground(false);
}

// ── Online and offline ───────────────────────────────────────────────────────

/** Where the phone is now, or null if location is refused or unavailable. */
async function here(): Promise<{ lat: number; lng: number } | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return null;
  }
}

/**
 * Go online. Throws with the server's sentence (or ours, for a refused
 * location) so the toggle can show it - a switch that silently stays off is
 * the worst version of this.
 */
export async function goOnline(): Promise<void> {
  const at = await here();
  if (!at) {
    throw new Error('Turn on location to go online. Orders go first to the couriers nearest the shop.');
  }
  const res = await api.goOnline(at);
  setOnline(res.online);
  if (res.online) await startBackground(true);
}

export async function goOffline(): Promise<void> {
  // Stop locating first: if the request fails, the rider has still stopped
  // being tracked, and the server forgets them within 30 minutes anyway.
  await stopBackground();
  const res = await api.goOffline();
  setOnline(res.online);
}

/** Ask the server, rather than trusting what this phone last believed. */
export async function refreshPresence(): Promise<void> {
  try {
    const res = await api.presence();
    setOnline(res.online);
    // Bring the task in line with the server, without prompting: an app
    // reopened after a restart picks it back up, and one that is offline
    // stops a task left over from before.
    if (res.online) await startBackground(false);
    else await stopBackground();
  } catch {
    // Signed out, or no network. Leave the last known answer.
  }
}

/**
 * Forget on sign-out, so the next account does not inherit it. Does not stop
 * the background task: this also runs while auth is still loading on a cold
 * start, and stopping there would switch a rider off every time they opened
 * the app. Sign-out calls stopBackground itself.
 */
export function resetPresence() {
  setOnline(null);
}

/**
 * Mount once, at the root, for a signed-in courier. Sends a heartbeat on a
 * timer and whenever the app comes back to the foreground, while online. With
 * the background task running this is a duplicate while the app is open,
 * which costs one small request every few minutes and covers the rider who
 * refused background location.
 */
export function usePresenceHeartbeat(enabled: boolean) {
  const isOnline = usePresence();

  // Learn the server's answer once per session.
  useEffect(() => {
    if (!enabled) {
      resetPresence();
      return;
    }
    void refreshPresence();
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !isOnline) return;

    let stopped = false;
    async function beat() {
      if (stopped || AppState.currentState !== 'active') return;
      const at = await here();
      if (!at || stopped) return;
      try {
        const res = await api.goOnline(at);
        setOnline(res.online);
      } catch {
        // A missed beat is fine - the server's timeout is ten of these.
      }
    }

    void beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void beat();
    });
    return () => {
      stopped = true;
      clearInterval(timer);
      sub.remove();
    };
  }, [enabled, isOnline]);
}
