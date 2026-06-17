// Razorpay removed — UPI deep link payments are used instead.
// This file is kept as a placeholder to avoid broken imports during transition.
export function openRazorpayCheckout(_opts: unknown): Promise<never> {
  return Promise.reject(new Error('Razorpay has been removed. Use UPI deep links instead.'));
}
