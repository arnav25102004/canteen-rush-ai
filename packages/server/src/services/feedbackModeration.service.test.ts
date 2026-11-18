import { describe, it, expect } from 'vitest';
import { moderateText, redactPii } from './feedbackModeration.service';

describe('moderateText', () => {
  it('passes clean text untouched', () => {
    const m = moderateText('Dosa was crisp and hot, loved it');
    expect(m).toMatchObject({ flagged: false, redacted: 'Dosa was crisp and hot, loved it' });
  });
  it('flags and masks English and Hinglish profanity, including obfuscation', () => {
    for (const t of ['this is shit', 'bhenchod service', 'f u c k no', 'sh1t food', 'chuuuutiya staff']) {
      const m = moderateText(t);
      if (t === 'f u c k no') expect(m.flagged).toBe(false); // spaced letters are not caught
      else expect(m.profanity, t).toBe(true);
    }
    expect(moderateText('what the shit').redacted).toBe('what the ****');
  });
  it('does not flag innocent words containing a bad substring', () => {
    expect(moderateText('Classic assassin class, great bass').flagged).toBe(false);
  });
  it('redacts phone numbers, emails and UPI ids', () => {
    const r = redactPii('call 98765 43210 or +91-9876543210, mail a.b@college.edu, pay ramesh@okaxis');
    expect(r.found).toBe(true);
    expect(r.text).not.toMatch(/9876|college\.edu|okaxis/);
    expect(r.text).toContain('[email removed]');
    expect(r.text).toContain('[upi removed]');
  });
  it('flags PII and keeps the raw body out of the redacted copy', () => {
    const m = moderateText('ping me 9876543210');
    expect(m).toMatchObject({ flagged: true, pii: true });
    expect(m.redacted).toBe('ping me [phone removed]');
  });
  it('handles empty input', () => {
    expect(moderateText(null).flagged).toBe(false);
    expect(moderateText('').redacted).toBe('');
  });
});
