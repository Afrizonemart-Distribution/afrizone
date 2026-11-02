import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import { api, ApiError } from '../api/client';
import type { EvidenceStage } from '../api/types';

/**
 * Work done with no signal, kept on the phone and sent when there is some
 * (Blueprint §16, offline-tolerant flows).
 *
 * WHAT QUEUES, AS DECIDED: the things done in the field, where signal is worst
 * and the work cannot wait - clocking in and out, job photos and signatures,
 * and a delivery's collected / delivered / could-not-deliver. Applying,
 * withdrawing, KYC and signing in still need signal: each depends on an answer
 * the person has to see before they go on.
 *
 * IN ORDER, ONE AT A TIME. A photo goes before the step it proves, a clock-in
 * before its clock-out. So once anything is waiting, new actions wait behind
 * it rather than overtaking, even if the signal has just come back.
 *
 * SENDING TWICE IS SAFE. A clock event carries its own id and the time it was
 * tapped (server services/clockTime.ts); a delivery already in the state asked
 * for answers OK; a photo is written down as uploaded the moment it is, so a
 * retry does not send it again.
 *
 * WHAT CANNOT BE SENT IS SAID. No signal or a server that is struggling: try
 * again later. Anything else - a wrong delivery code, a job that was taken
 * away - is a refusal: the item is marked failed with the server's reason, the
 * phone shows a notification, and it stays on screen until it is dismissed.
 */

type At = { lat: number; lng: number; accuracy: number | null } | null;

export type OutboxAction =
  | { kind: 'evidence'; taskId: string; stage: EvidenceStage; uri: string; mimeType: string; at: At; capturedAt: string }
  | {
      kind: 'signature';
      taskId: string;
      stage: EvidenceStage;
      signerName: string;
      path: string;
      width: number;
      height: number;
      at: At;
      capturedAt: string;
    }
  | {
      kind: 'clock';
      taskId: string;
      type: 'IN' | 'OUT';
      lat: number | null;
      lng: number | null;
      occurredAt: string;
      clientId: string;
      /** A clock photo taken offline, sent first. Replaced by evidenceId once it is. */
      photo?: { uri: string; mimeType: string; at: At; capturedAt: string } | null;
      evidenceId?: string | null;
    }
  | { kind: 'pickedUp'; deliveryId: string }
  | { kind: 'complete'; deliveryId: string; code: string }
  | { kind: 'failed'; deliveryId: string; reason: string };

export interface OutboxItem {
  id: string;
  userId: string;
  action: OutboxAction;
  /** What it was, in words, for the list and the notification. */
  label: string;
  createdAt: string;
  state: 'waiting' | 'failed';
  error?: string;
}

const KEY = 'afz.outbox.v1';
const DIR = `${FileSystem.documentDirectory ?? ''}outbox/`;

let items: OutboxItem[] = [];
let loaded = false;
let userId: string | null = null;
let flushing = false;
const listeners = new Set<() => void>();
const sentListeners = new Set<(item: OutboxItem) => void>();

function emit() {
  items = [...items];
  listeners.forEach((l) => l());
}

async function persist() {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Kept in memory for this session either way.
  }
}

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) items = JSON.parse(raw) as OutboxItem[];
  } catch {
    items = [];
  }
  emit();
}

async function deleteFiles(item: OutboxItem) {
  const a = item.action;
  const uri = a.kind === 'evidence' ? a.uri : a.kind === 'clock' ? a.photo?.uri : undefined;
  if (uri && uri.startsWith(DIR)) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
}

/**
 * The camera's file lives in a cache the system may clear. A photo that has to
 * survive until there is signal is copied somewhere it will not be.
 */
async function keepFile(uri: string, id: string, mimeType: string): Promise<string> {
  if (!FileSystem.documentDirectory) return uri;
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => undefined);
  const to = `${DIR}${id}${mimeType === 'image/png' ? '.png' : '.jpg'}`;
  await FileSystem.copyAsync({ from: uri, to });
  return to;
}

export function isNoSignal(e: unknown): boolean {
  return e instanceof ApiError && e.status === 0;
}

/** Worth trying again later, as opposed to a refusal. */
function isTransient(e: unknown): boolean {
  if (!(e instanceof ApiError)) return true;
  return e.status === 0 || e.status === 401 || e.status === 408 || e.status === 429 || e.status >= 500;
}

export function newClientId(): string {
  return Crypto.randomUUID();
}

/** Do it, against the API. Used for the first try and for every retry. */
async function perform(item: OutboxItem): Promise<unknown> {
  const a = item.action;
  switch (a.kind) {
    case 'evidence':
      return api.uploadEvidence({ ...a, capturedAt: new Date(a.capturedAt) });
    case 'signature':
      return api.sendSignature({ ...a, capturedAt: new Date(a.capturedAt) });
    case 'clock': {
      if (a.photo && !a.evidenceId) {
        const shot = await api.uploadEvidence({
          taskId: a.taskId,
          stage: a.type === 'IN' ? 'CLOCK_IN' : 'CLOCK_OUT',
          ...a.photo,
          capturedAt: new Date(a.photo.capturedAt),
        });
        // Written down at once, so a retry of the clock does not upload it again.
        a.evidenceId = shot.id;
        await persist();
      }
      return api.clock({
        taskId: a.taskId,
        type: a.type,
        lat: a.lat,
        lng: a.lng,
        evidenceId: a.evidenceId ?? null,
        occurredAt: a.occurredAt,
        clientId: a.clientId,
      });
    }
    case 'pickedUp':
      return api.markPickedUp(a.deliveryId);
    case 'complete':
      return api.completeDelivery(a.deliveryId, a.code);
    case 'failed':
      return api.failDelivery(a.deliveryId, a.reason);
  }
}

function mine(): OutboxItem[] {
  return userId ? items.filter((i) => i.userId === userId) : [];
}

function hasWaiting(): boolean {
  return mine().some((i) => i.state === 'waiting');
}

async function enqueue(action: OutboxAction, label: string): Promise<OutboxItem> {
  if (!userId) throw new Error('Sign in again to save this.');
  const id = Crypto.randomUUID();
  if (action.kind === 'evidence') action.uri = await keepFile(action.uri, id, action.mimeType);
  if (action.kind === 'clock' && action.photo) {
    action.photo.uri = await keepFile(action.photo.uri, id, action.photo.mimeType);
  }
  const item: OutboxItem = { id, userId, action, label, createdAt: new Date().toISOString(), state: 'waiting' };
  items.push(item);
  emit();
  await persist();
  return item;
}

export type Sent<T> = { queued: false; result: T } | { queued: true; item: OutboxItem };

/**
 * Do this now if there is signal and nothing ahead of it, otherwise keep it
 * for later. Refusals while online are thrown as before, so screens handle a
 * wrong code or a missing photo exactly as they always did.
 */
export async function sendOrQueue<T>(action: OutboxAction, label: string): Promise<Sent<T>> {
  await load();
  if (hasWaiting()) {
    const item = await enqueue(action, label);
    void flush();
    return { queued: true, item };
  }
  const probe: OutboxItem = { id: 'now', userId: userId ?? '', action, label, createdAt: '', state: 'waiting' };
  try {
    return { queued: false, result: (await perform(probe)) as T };
  } catch (e) {
    if (!isNoSignal(e)) throw e;
    return { queued: true, item: await enqueue(action, label) };
  }
}

async function tellFailed(item: OutboxItem) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Not sent',
        body: `${item.label}: ${item.error}`,
        data: { screen: item.action.kind === 'clock' ? 'task' : 'deliveries', id: 'taskId' in item.action ? item.action.taskId : undefined },
      },
      trigger: null,
    });
  } catch {
    // The item is still on screen, marked; the notification is a courtesy.
  }
}

/** Send what is waiting, in order, stopping at the first sign of no signal. */
export async function flush(): Promise<void> {
  await load();
  if (flushing || !userId) return;
  flushing = true;
  try {
    for (const item of mine()) {
      if (item.state !== 'waiting') continue;
      try {
        await perform(item);
        items = items.filter((i) => i.id !== item.id);
        emit();
        await persist();
        await deleteFiles(item);
        sentListeners.forEach((l) => l(item));
      } catch (e) {
        if (isTransient(e)) break;
        item.state = 'failed';
        item.error = e instanceof Error ? e.message : 'It was refused.';
        emit();
        await persist();
        await tellFailed(item);
      }
    }
  } finally {
    flushing = false;
  }
}

/**
 * Whose work this phone is sending. Work queued by somebody who has since
 * signed out is not sent under the next person's name: it is dropped when a
 * different account signs in.
 */
export async function setOutboxUser(id: string | null): Promise<void> {
  await load();
  userId = id;
  if (id) {
    const others = items.filter((i) => i.userId !== id);
    if (others.length) {
      items = items.filter((i) => i.userId === id);
      emit();
      await persist();
      await Promise.all(others.map(deleteFiles));
    }
  }
  emit();
}

export async function dismiss(id: string): Promise<void> {
  const item = items.find((i) => i.id === id);
  items = items.filter((i) => i.id !== id);
  emit();
  await persist();
  if (item) await deleteFiles(item);
}

export function waitingCount(): number {
  return mine().filter((i) => i.state === 'waiting').length;
}

/** Told each time a queued item goes through, so a screen can load again. */
export function onSent(listener: (item: OutboxItem) => void): () => void {
  sentListeners.add(listener);
  return () => sentListeners.delete(listener);
}

function subscribe(l: () => void) {
  listeners.add(l);
  void load();
  return () => listeners.delete(l);
}

/** This account's queue, live. */
export function useOutbox(): OutboxItem[] {
  const all = useSyncExternalStore(subscribe, () => items);
  return userId ? all.filter((i) => i.userId === userId) : [];
}
