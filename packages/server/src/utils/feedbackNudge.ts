import { istHour } from './helpers';

const MIN = 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
export const NUDGE_MIN_DELAY_MIN = 25;
export const NUDGE_MAX_DELAY_MIN = 40;
export const QUIET_START_HOUR = 22; // IST, inclusive
export const QUIET_END_HOUR = 8; // IST, exclusive

/** True when an instant falls in the 22:00-08:00 IST quiet window. */
export function inQuietHours(at: Date): boolean {
  const h = istHour(at);
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}

/** The next 08:00 IST at or after a quiet-hours instant (same morning, or tomorrow after 22:00). */
export function nextMorning(at: Date): Date {
  const istMs = at.getTime() + IST_OFFSET_MS;
  const dayStart = Math.floor(istMs / 86_400_000) * 86_400_000;
  const addDay = istHour(at) >= QUIET_START_HOUR ? 86_400_000 : 0;
  return new Date(dayStart + addDay + QUIET_END_HOUR * 60 * MIN - IST_OFFSET_MS);
}

/** Moves a send time out of quiet hours; otherwise returns it unchanged. */
export function avoidQuietHours(at: Date): Date {
  return inQuietHours(at) ? nextMorning(at) : at;
}

/** Pickup time plus a random 25-40 minutes, pushed to 08:00 IST if it would land in quiet hours. */
export function computeNudgeAt(pickedUpAt: Date, rand: () => number = Math.random): Date {
  const delay = NUDGE_MIN_DELAY_MIN + rand() * (NUDGE_MAX_DELAY_MIN - NUDGE_MIN_DELAY_MIN);
  return avoidQuietHours(new Date(pickedUpAt.getTime() + delay * MIN));
}
