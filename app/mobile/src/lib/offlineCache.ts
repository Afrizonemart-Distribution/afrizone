import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The last copy of a screen's data, for when there is no signal (Blueprint
 * §16). A courier at a door in a dead zone still needs the address and the
 * order; a Tasker in a basement still needs to see the job they are on.
 *
 * Plain AsyncStorage, not the secure store: these are API responses, too big
 * for it, and nothing here is a credential. Some of it is personal - a
 * delivery carries the customer's name and address - so every copy is
 * deleted on sign-out (clearCache, from AuthContext), and the server's own
 * seven-day purge reaches it the next time the screen loads online.
 */
const PREFIX = 'afz.cache.v1:';

export interface Cached<T> {
  data: T;
  savedAt: string;
}

export async function saveCache<T>(key: string, data: T): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify({ data, savedAt: new Date().toISOString() }));
  } catch {
    // A full disk is not a reason to fail a screen that just loaded.
  }
}

export async function readCache<T>(key: string): Promise<Cached<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as Cached<T>) : null;
  } catch {
    return null;
  }
}

export async function clearCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) => k.startsWith(PREFIX));
    if (mine.length) await AsyncStorage.multiRemove(mine);
  } catch {
    // Nothing to do about it; the next sign-in overwrites what it loads.
  }
}

/**
 * Ask the server and keep the answer; with no signal, give the kept one. For
 * calls made outside useAsync. Anything other than "no signal" is thrown as
 * it would have been.
 */
export async function cachedCall<T>(key: string, call: () => Promise<T>): Promise<T> {
  try {
    const fresh = await call();
    void saveCache(key, fresh);
    return fresh;
  } catch (e) {
    if ((e as { status?: number } | null)?.status !== 0) throw e;
    const kept = await readCache<T>(key);
    if (kept) return kept.data;
    throw e;
  }
}
