/**
 * Text moderation for feedback: profanity (English + Hinglish) and PII (phone, email, UPI id).
 * Flagged text is redacted for vendor and public views; admins see the raw body. The author is
 * never told a review was flagged.
 */

const PROFANITY = [
  'fuck', 'fucking', 'shit', 'bitch', 'bastard', 'asshole', 'dick', 'cunt', 'slut', 'whore', 'motherfucker',
  'bhenchod', 'behenchod', 'bhosdike', 'bhosdi', 'madarchod', 'maderchod', 'chutiya', 'chutiye', 'gandu',
  'gaand', 'lund', 'loda', 'randi', 'harami', 'haramkhor', 'kutta', 'kamina', 'saala', 'bakchod', 'bsdk', 'mc', 'bc',
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

/** Lower-case, undo common leetspeak, collapse repeated letters ("fuuuck" -> "fuck"). */
function normaliseWord(w: string): string {
  return w
    .toLowerCase()
    .replace(/[0134578@$!]/g, (c) => LEET[c] ?? c)
    .replace(/(.)\1{2,}/g, '$1$1')
    .replace(/(.)\1+/g, '$1');
}

const PROFANITY_NORM = new Set(PROFANITY.map(normaliseWord));

const WORD_RE = /[\p{L}\p{N}@$!]+/gu;

function maskProfanity(text: string): { text: string; found: boolean } {
  let found = false;
  const out = text.replace(WORD_RE, (w) => {
    if (w.length >= 2 && PROFANITY_NORM.has(normaliseWord(w))) {
      found = true;
      return '*'.repeat(w.length);
    }
    return w;
  });
  return { text: out, found };
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
// UPI handle: name@bank with no dot in the domain part (okaxis, ybl, paytm, upi ...).
const UPI_RE = /\b[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}\b/g;
// Indian mobile (optional +91 / 0), or any run of 10+ digits allowing spaces/dashes.
const PHONE_RE = /(?:\+?91[\s-]?|0)?[6-9](?:[\s-]?\d){9}\b|\d(?:[\s-]?\d){9,}/g;

export interface ModerationResult {
  flagged: boolean;
  profanity: boolean;
  pii: boolean;
  /** Text safe for vendor and public views. */
  redacted: string;
}

export function redactPii(text: string): { text: string; found: boolean } {
  let found = false;
  const sub = (re: RegExp, label: string) => {
    text = text.replace(re, () => {
      found = true;
      return label;
    });
  };
  sub(EMAIL_RE, '[email removed]');
  sub(UPI_RE, '[upi removed]');
  sub(PHONE_RE, '[phone removed]');
  return { text, found };
}

export function moderateText(body: string | null | undefined): ModerationResult {
  if (!body) return { flagged: false, profanity: false, pii: false, redacted: '' };
  const pii = redactPii(body);
  const prof = maskProfanity(pii.text);
  return {
    flagged: pii.found || prof.found,
    profanity: prof.found,
    pii: pii.found,
    redacted: prof.text,
  };
}
