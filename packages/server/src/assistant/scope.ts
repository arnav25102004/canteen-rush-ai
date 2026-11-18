// Zero-token scope pre-screen. Each pattern needs a task verb plus a non-food object.
// There are deliberately NO food-word blocklists.

export const REFUSAL =
  'I can only help with Campus Khana canteens, menus, orders, slots and points.';

const LANG = '(?:python|java|javascript|typescript|c\\+\\+|c#|html|css|sql|react|node\\.?js|php|rust|golang)';
const CODE_OBJ = '(?:code|program|script|function|essay|poem|story|email|sql|query|algorithm|song|article)';
const GAP = '(?:(?:me|a|an|the|some|simple|short|quick|full|long|detailed|new|' + LANG + ')\\s+){0,3}';

const PATTERNS: RegExp[] = [
  // 1. code fences
  /```/,
  // 2. write/generate/make/create + non-food object
  new RegExp(`\\b(?:write|generate|make|create|compose|draft)\\s+${GAP}${CODE_OBJ}\\b`, 'i'),
  // 3a. language ... code/program/script
  new RegExp(`(?<!\\w)${LANG}(?!\\w)[^.?!\\n]{0,20}\\b(?:code|program|script)\\b`, 'i'),
  // 3b. code/program/script ... in/using language
  new RegExp(`\\b(?:code|program|script)\\b[^.?!\\n]{0,15}\\b(?:in|using|with)\\s+${LANG}(?!\\w)`, 'i'),
  // 4. maths and homework
  /\bsolve\b[^.?!\n]{0,30}\b(?:equation|integral|derivative|assignment|homework)\b/i,
  /\b(?:do|finish|complete)\s+my\s+(?:homework|assignment)\b/i,
  // 5. translation
  /\btranslate\b[^.?!\n]{0,60}\b(?:to|into)\b/i,
  // 6. instruction override
  /\b(?:ignore|disregard|forget)\s+(?:all|any|the|your)?\s*(?:previous|prior|above|earlier)?\s*(?:instructions|rules|prompts?)\b/i,
  // 7. prompt extraction and jailbreak words
  /\b(?:system prompt|developer mode|jailbreak)\b/i,
  /\bDAN\b/,
];

export function preScreen(text: string): 'refuse' | 'ok' {
  for (const p of PATTERNS) if (p.test(text)) return 'refuse';
  return 'ok';
}
