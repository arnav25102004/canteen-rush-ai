// Feature flags — toggle via Render environment variables, no code deploy needed.
// RAZORPAY_ENABLED=false  → Pay at Counter mode (all orders confirmed instantly, student pays cash)
// RAZORPAY_ENABLED=true   → Razorpay Route split payments (requires live account + webhook)
export const FEATURES = {
  RAZORPAY_ENABLED: process.env.RAZORPAY_ENABLED === 'true',
};
