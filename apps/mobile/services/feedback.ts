import api from './api';

export interface EligibilityItem { menuItemId: string; name?: string }
export interface Eligibility {
  eligible: boolean;
  reason?: string;
  existingFeedbackId?: string;
  editDeadline?: string;
  items: EligibilityItem[];
}

export interface ItemRatingInput {
  menuItemId: string;
  rating: number;
  taste?: number;
  portion?: number;
  value?: number;
}

export interface CreateReviewPayload {
  orderId: string;
  clientRequestId: string;
  overallRating: number;
  tags?: string[];
  body?: string;
  isAnonymous?: boolean;
  items?: ItemRatingInput[];
}

export interface UpdateReviewPayload {
  overallRating?: number;
  tags?: string[];
  body?: string | null;
  items?: ItemRatingInput[];
}

export interface MyFeedback {
  id: string;
  kind: string;
  status: string;
  orderId: string | null;
  overallRating: number | null;
  tags: string[];
  body: string | null;
  isAnonymous: boolean;
  createdAt: string;
  editDeadline: string | null;
  items: ItemRatingInput[];
  /** Set only on a fresh review: points the server actually awarded (0 or absent when none). */
  pointsAwarded?: number;
}

export type AppFeedbackKind = 'APP_BUG' | 'APP_IDEA' | 'APP_PRAISE' | 'APP_OTHER';
export type AppSeverity = 'ANNOYING' | 'BLOCKS_ME' | 'PAYMENT_ISSUE';

export interface AppFeedbackPayload {
  clientRequestId: string;
  kind: AppFeedbackKind;
  body?: string;
  severity?: AppSeverity;
  tags?: string[];
  isAnonymous?: boolean;
  contextJson?: Record<string, unknown>;
}

export interface TimelineEntry {
  type: string;
  toStatus: string | null;
  reply: string | null;
  createdAt: string;
}

export interface MyFeedbackListItem extends MyFeedback {
  timeline: TimelineEntry[];
  supportHint?: string;
}

export const REVIEW_TIMEOUT_MS = 15000;

export async function createAppFeedback(p: AppFeedbackPayload): Promise<MyFeedbackListItem> {
  const { data } = await api.post('/feedback/app', p, { timeout: REVIEW_TIMEOUT_MS });
  return data.feedback;
}

export async function listMyFeedback(page = 1, limit = 30): Promise<{ feedback: MyFeedbackListItem[]; total: number }> {
  const { data } = await api.get('/feedback/mine', { params: { page, limit } });
  return { feedback: data.feedback ?? [], total: data.total ?? 0 };
}

export async function getEligibility(orderId: string): Promise<Eligibility> {
  const { data } = await api.get(`/feedback/eligibility/${orderId}`);
  return data;
}

export async function createReview(p: CreateReviewPayload): Promise<MyFeedback> {
  const { data } = await api.post('/feedback/order', p, { timeout: REVIEW_TIMEOUT_MS });
  return data.feedback;
}

export async function updateReview(id: string, p: UpdateReviewPayload): Promise<MyFeedback> {
  const { data } = await api.patch(`/feedback/${id}`, p, { timeout: REVIEW_TIMEOUT_MS });
  return data.feedback;
}

export async function getMyFeedback(id: string): Promise<MyFeedback> {
  const { data } = await api.get(`/feedback/${id}`);
  return data.feedback;
}

/** Map of orderId to feedback id for the caller's recent order reviews (first 50). */
export async function getReviewedOrderIds(): Promise<Record<string, string>> {
  const { data } = await api.get('/feedback/mine', { params: { limit: 50 } });
  const out: Record<string, string> = {};
  for (const f of data.feedback ?? []) if (f.kind === 'ORDER_REVIEW' && f.orderId) out[f.orderId] = f.id;
  return out;
}

export interface FeedbackStreak {
  currentStreakWeeks: number;
  bestStreakWeeks: number;
  pointsEarnedToday: number;
  dailyCapRemaining: number;
}

export async function getFeedbackStreak(): Promise<FeedbackStreak> {
  const { data } = await api.get('/feedback/streak');
  return data;
}

export interface ChangelogEntry { id: string; title: string; body: string; canteenId: string | null; publishedAt: string }

export async function getChangelog(page = 1, limit = 20): Promise<{ entries: ChangelogEntry[]; total: number }> {
  const { data } = await api.get('/feedback/changelog', { params: { page, limit } });
  return { entries: data.entries ?? [], total: data.total ?? 0 };
}

export const REVIEW_WINDOW_MS = 7 * 24 * 3600 * 1000;

/** Client-side hint only; the server is the authority. */
export function withinReviewWindow(pickedUpAt?: string | null, now = Date.now()): boolean {
  if (!pickedUpAt) return false;
  return now - new Date(pickedUpAt).getTime() <= REVIEW_WINDOW_MS;
}

export function newRequestId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export interface Idea {
  id: string;
  text: string;
  voteCount: number;
  voted: boolean;
  status: string;
  mine: boolean;
  createdAt: string;
}

export async function listIdeas(cursor?: string): Promise<{ ideas: Idea[]; nextCursor: string | null }> {
  const { data } = await api.get('/feedback/ideas', { params: { cursor, limit: 20 } });
  return { ideas: data.ideas ?? [], nextCursor: data.nextCursor ?? null };
}

export async function voteIdea(id: string): Promise<{ voted: boolean; voteCount: number }> {
  const { data } = await api.post(`/feedback/${id}/vote`);
  return data;
}

export async function unvoteIdea(id: string): Promise<{ voted: boolean; voteCount: number }> {
  const { data } = await api.delete(`/feedback/${id}/vote`);
  return data;
}
