export const ORDER_STATUS = {
  CONFIRMED: 'CONFIRMED',
  ACCEPTED: 'ACCEPTED',
  PREPARING: 'PREPARING',
  READY: 'READY',
  PICKED_UP: 'PICKED_UP',
  CANCELLED: 'CANCELLED',
} as const;

export const USER_ROLE = {
  STUDENT: 'STUDENT',
  FACULTY: 'FACULTY',
  VENDOR: 'VENDOR',
  ADMIN: 'ADMIN',
} as const;

export const WALLET = {
  MIN_RECHARGE: 50,
  MAX_RECHARGE: 5000,
  MIN_BALANCE_FOR_ORDER: 0,
} as const;

export const PAGINATION = {
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

export const DEFAULT_INSTITUTION_SLUG = 'christ-bgr';
