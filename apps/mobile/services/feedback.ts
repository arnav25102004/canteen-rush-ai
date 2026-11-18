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
}

export const REVIEW_TIMEOUT_MS = 15000;

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
