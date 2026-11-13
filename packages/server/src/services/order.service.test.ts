import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database', () => ({ prisma: {} }));
vi.mock('../config/redis', () => ({ cacheDel: vi.fn(), slotCacheKeys: () => [] }));
vi.mock('./qr.service', () => ({ generateQRToken: vi.fn() }));
vi.mock('./notification.service', () => ({ sendOrderNotification: vi.fn() }));

const features = vi.hoisted(() => ({ RAZORPAY_ENABLED: false }));
vi.mock('../config/features', () => ({ FEATURES: features }));

import { decidePayment, refundableAmount } from './order.service';

describe('decidePayment', () => {
  beforeEach(() => { features.RAZORPAY_ENABLED = false; });

  it('cash orders start unpaid (paid at pickup), not PAID', () => {
    expect(decidePayment(80, false)).toMatchObject({ paymentMethod: 'CASH', paymentStatus: 'AWAITING_PAYMENT', status: 'CONFIRMED' });
    expect(decidePayment(80, true)).toMatchObject({ paymentMethod: 'CASH', paymentStatus: 'AWAITING_PAYMENT' });
  });

  it('fully covered orders are paid by wallet', () => {
    expect(decidePayment(0, true)).toMatchObject({ paymentMethod: 'WALLET', paymentStatus: 'PAID' });
  });

  it('uses Razorpay only when enabled and the canteen has an account', () => {
    features.RAZORPAY_ENABLED = true;
    expect(decidePayment(80, true)).toMatchObject({ paymentMethod: 'RAZORPAY', status: 'PENDING' });
    expect(decidePayment(80, false).paymentMethod).toBe('CASH');
  });
});

describe('refundableAmount', () => {
  it('never refunds the unpaid cash part of a cancelled order', () => {
    expect(refundableAmount({ paymentMethod: 'CASH', paymentStatus: 'AWAITING_PAYMENT', totalAmount: 80, walletDebit: 0 })).toBe(0);
  });

  it('returns wallet credit that was applied', () => {
    expect(refundableAmount({ paymentMethod: 'CASH', paymentStatus: 'AWAITING_PAYMENT', totalAmount: 80, walletDebit: 20 })).toBe(20);
  });

  it('refunds captured online payments plus wallet credit', () => {
    expect(refundableAmount({ paymentMethod: 'RAZORPAY', paymentStatus: 'PAID', totalAmount: 80, walletDebit: 20 })).toBe(100);
    expect(refundableAmount({ paymentMethod: 'RAZORPAY', paymentStatus: 'AWAITING_PAYMENT', totalAmount: 80, walletDebit: 0 })).toBe(0);
  });
});
