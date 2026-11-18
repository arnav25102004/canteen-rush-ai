// Feature flags — toggle via Render environment variables, no code deploy needed.
// RAZORPAY_ENABLED=false  → Pay at Counter mode (all orders confirmed instantly, student pays cash)
// RAZORPAY_ENABLED=true   → Razorpay Route split payments (requires live account + webhook)
// ASSISTANT_ENABLED=true  → AI ordering assistant, but only when GROQ_API_KEY is also set.
//                           A missing key just leaves it off; it never stops the server booting.
export const FEATURES = {
  RAZORPAY_ENABLED: process.env.RAZORPAY_ENABLED === 'true',
  ASSISTANT_ENABLED: process.env.ASSISTANT_ENABLED === 'true' && !!process.env.GROQ_API_KEY?.trim(),
};
