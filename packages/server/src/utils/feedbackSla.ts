import { FeedbackPriority } from '@prisma/client';

const HOUR = 3600 * 1000;
export const SLA_HOURS: Record<FeedbackPriority, number> = {
  URGENT: 4,
  HIGH: 24,
  NORMAL: 72,
  LOW: 7 * 24,
};

/** When a feedback item of this priority must be handled by, counted from creation. */
export function slaDueAt(priority: FeedbackPriority, from: Date): Date {
  return new Date(from.getTime() + SLA_HOURS[priority] * HOUR);
}
