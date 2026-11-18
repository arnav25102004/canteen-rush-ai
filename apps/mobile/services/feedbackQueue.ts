import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import {
  createReview, updateReview, createAppFeedback, CreateReviewPayload, AppFeedbackPayload, MyFeedback,
} from './feedback';

/**
 * Offline-safe review submit. The payload (with its clientRequestId) is persisted before the
 * first attempt, so a retry can never create a second review: the server returns the same row.
 */

const QUEUE_KEY = 'feedback_queue_v1';
const DRAFT_PREFIX = 'feedback_draft_v1:';
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 5 * 60 * 1000;

export interface QueueItem {
  /** Queue key: the order id, or `app:<clientRequestId>` for app feedback. */
  orderId: string;
  mode: 'create' | 'edit';
  payload: CreateReviewPayload;
  /** Set for app feedback; the item is then sent to POST /feedback/app and `payload` is unused. */
  appPayload?: AppFeedbackPayload;
  feedbackId?: string; // set in edit mode
  attempts: number;
  nextAt: number;
  createdAt: number;
}

export type QueueEvent =
  | { type: 'sent'; orderId: string; feedback: MyFeedback }
  | { type: 'failed'; orderId: string; message: string; status?: number; code?: string };

type Listener = () => void;
type EventListener = (e: QueueEvent) => void;

let items: QueueItem[] | null = null;
const inFlight = new Set<string>();
let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();
const eventListeners = new Set<EventListener>();

function notify() { listeners.forEach((l) => l()); }
function emit(e: QueueEvent) { eventListeners.forEach((l) => l(e)); }

async function load(): Promise<QueueItem[]> {
  if (items) return items;
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    items = raw ? JSON.parse(raw) : [];
  } catch { items = []; }
  return items!;
}

async function save() {
  try { await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items ?? [])); } catch { /* best effort */ }
}

export function backoffDelay(attempts: number): number {
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1));
}

/** 4xx means the server rejected it for good, except timeouts and rate limits. */
export function isPermanentFailure(status?: number): boolean {
  return status != null && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export function subscribeQueue(l: Listener) { listeners.add(l); return () => { listeners.delete(l); }; }
export function subscribeQueueEvents(l: EventListener) { eventListeners.add(l); return () => { eventListeners.delete(l); }; }

export type OrderQueueState = 'sending' | 'queued' | null;

/** Synchronous once the queue has loaded (call ensureLoaded first). */
export function getOrderQueueState(orderId: string): OrderQueueState {
  const it = items?.find((i) => i.orderId === orderId);
  if (!it) return null;
  return inFlight.has(orderId) ? 'sending' : 'queued';
}

export async function ensureLoaded() { await load(); notify(); }

function toEditPayload(p: CreateReviewPayload) {
  return { overallRating: p.overallRating, tags: p.tags, body: p.body ?? null, items: p.items };
}

async function removeItem(orderId: string) {
  const list = await load();
  items = list.filter((i) => i.orderId !== orderId);
  await save();
}

async function attempt(item: QueueItem): Promise<'done' | 'retry'> {
  inFlight.add(item.orderId);
  notify();
  try {
    let feedback: MyFeedback;
    if (item.appPayload) feedback = await createAppFeedback(item.appPayload);
    else if (item.mode === 'edit' && item.feedbackId) feedback = await updateReview(item.feedbackId, toEditPayload(item.payload));
    else feedback = await createReview(item.payload);
    await removeItem(item.orderId);
    emit({ type: 'sent', orderId: item.orderId, feedback });
    return 'done';
  } catch (err: any) {
    const status: number | undefined = err?.response?.status;
    const data = err?.response?.data ?? {};
    const code: string | undefined = data.code;

    if (status === 409 && code === 'ALREADY_REVIEWED' && data.feedbackId && item.mode === 'create') {
      // Already reviewed (maybe by an earlier attempt of ours): apply our answers as an edit.
      item.mode = 'edit';
      item.feedbackId = data.feedbackId;
      await save();
      inFlight.delete(item.orderId);
      return attempt(item);
    }
    if (isPermanentFailure(status)) {
      await removeItem(item.orderId);
      emit({ type: 'failed', orderId: item.orderId, status, code, message: data.error || 'Request rejected' });
      return 'done';
    }
    item.attempts += 1;
    item.nextAt = Date.now() + backoffDelay(item.attempts);
    await save();
    return 'retry';
  } finally {
    inFlight.delete(item.orderId);
    notify();
  }
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = null;
  const list = items ?? [];
  if (!list.length) return;
  const next = Math.min(...list.map((i) => i.nextAt));
  timer = setTimeout(() => { void processQueue(); }, Math.max(500, next - Date.now()));
}

export async function processQueue(force = false) {
  const list = await load();
  const now = Date.now();
  for (const item of [...list]) {
    if (inFlight.has(item.orderId)) continue;
    if (!force && item.nextAt > now) continue;
    await attempt(item);
  }
  schedule();
}

export type SubmitResult =
  | { state: 'sent'; feedback: MyFeedback }
  | { state: 'queued' }
  | { state: 'failed'; message: string; status?: number; code?: string };

/** Persist first, then try once right away. Resolves with the outcome of that first attempt. */
export async function submitReview(
  orderId: string,
  payload: CreateReviewPayload,
  opts: { feedbackId?: string } = {},
): Promise<SubmitResult> {
  const list = await load();
  const item: QueueItem = {
    orderId, mode: opts.feedbackId ? 'edit' : 'create', payload, feedbackId: opts.feedbackId,
    attempts: 0, nextAt: 0, createdAt: Date.now(),
  };
  items = [...list.filter((i) => i.orderId !== orderId), item];
  await save();

  return new Promise<SubmitResult>((resolve) => {
    let settled = false;
    const off = subscribeQueueEvents((e) => {
      if (e.orderId !== orderId || settled) return;
      settled = true; off();
      if (e.type === 'sent') resolve({ state: 'sent', feedback: e.feedback });
      else resolve({ state: 'failed', message: e.message, status: e.status, code: e.code });
    });
    void attempt(item).then((r) => {
      if (r === 'retry' && !settled) { settled = true; off(); resolve({ state: 'queued' }); }
      schedule();
    });
  });
}

export const appQueueKey = (clientRequestId: string) => `app:${clientRequestId}`;

/** App feedback through the same offline queue. The clientRequestId makes retries idempotent. */
export async function submitAppFeedback(payload: AppFeedbackPayload): Promise<SubmitResult> {
  const key = appQueueKey(payload.clientRequestId);
  const list = await load();
  const item: QueueItem = {
    orderId: key, mode: 'create', payload: undefined as unknown as CreateReviewPayload, appPayload: payload,
    attempts: 0, nextAt: 0, createdAt: Date.now(),
  };
  items = [...list.filter((i) => i.orderId !== key), item];
  await save();

  return new Promise<SubmitResult>((resolve) => {
    let settled = false;
    const off = subscribeQueueEvents((e) => {
      if (e.orderId !== key || settled) return;
      settled = true; off();
      if (e.type === 'sent') resolve({ state: 'sent', feedback: e.feedback });
      else resolve({ state: 'failed', message: e.message, status: e.status, code: e.code });
    });
    void attempt(item).then((r) => {
      if (r === 'retry' && !settled) { settled = true; off(); resolve({ state: 'queued' }); }
      schedule();
    });
  });
}

/** Call once at app start: retries on reconnect and when the app returns to the foreground. */
export function startFeedbackQueue() {
  if (started) return () => {};
  started = true;
  void load().then(() => { notify(); return processQueue(true); });
  let wasOnline = true;
  const unNet = NetInfo.addEventListener((s) => {
    const online = s.isConnected !== false && s.isInternetReachable !== false;
    if (online && !wasOnline) void processQueue(true);
    wasOnline = online;
  });
  const sub = AppState.addEventListener('change', (st) => { if (st === 'active') void processQueue(); });
  return () => { unNet(); sub.remove(); if (timer) clearTimeout(timer); started = false; };
}

// ---- Per-order draft, so backgrounding or a crash does not lose answers ----

export interface ReviewDraft {
  step: number;
  vibe: number | null;
  itemRatings: Record<string, { rating: number; taste?: number; portion?: number; value?: number }>;
  skipped: string[];
  tags: string[];
  body: string;
  anonymous: boolean | null;
}

export async function saveDraft(orderId: string, d: ReviewDraft) {
  try { await AsyncStorage.setItem(DRAFT_PREFIX + orderId, JSON.stringify(d)); } catch { /* best effort */ }
}
export async function loadDraft(orderId: string): Promise<ReviewDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(DRAFT_PREFIX + orderId);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
export async function clearDraft(orderId: string) {
  try { await AsyncStorage.removeItem(DRAFT_PREFIX + orderId); } catch { /* best effort */ }
}
