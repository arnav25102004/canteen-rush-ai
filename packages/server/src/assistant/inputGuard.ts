// Pure input cleaning for assistant messages. No LLM, no I/O.

export const MAX_INPUT_CHARS = 500;
export const MAX_INPUT_LINES = 12;

export type NormalizeResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'empty' | 'too_long' | 'too_many_lines' | 'invalid' };

// Control characters except \n (handled separately), zero-width and bidi override characters.
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;
const ZERO_WIDTH = new RegExp('[' + [
  '\\u200B-\\u200F', '\\u2028', '\\u2029', '\\u202A-\\u202E', '\\u2060-\\u206F', '\\uFEFF', '\\u00AD',
].join('') + ']', 'g');

export function normalizeInput(text: unknown): NormalizeResult {
  if (typeof text !== 'string') return { ok: false, reason: 'invalid' };
  const cleaned = text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(ZERO_WIDTH, '')
    .replace(CONTROL, ' ');
  const lines = cleaned
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { ok: false, reason: 'empty' };
  if (lines.length > MAX_INPUT_LINES) return { ok: false, reason: 'too_many_lines' };
  const out = lines.join('\n');
  if ([...out].length > MAX_INPUT_CHARS) return { ok: false, reason: 'too_long' };
  return { ok: true, text: out };
}
