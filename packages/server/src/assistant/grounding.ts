import type { EntityDict } from './entityDict';

export const NOT_FOUND =
  "I couldn't find that at your campus canteens. Try different words or browse the menu.";
export const GENERIC = "Sorry, I couldn't check that. Ask me about a canteen, item or slot.";

export interface FactSet {
  numbers: Set<string>; // normalised numeric strings
  times: Set<string>; // 24h "HH:MM"
  haystack: string; // lowercased text for name lookups
}

const num = (s: string) => String(parseFloat(s));
const pad = (n: number) => String(n).padStart(2, '0');

function toTime(h: number, m: number, ampm?: string, baje = false): string | null {
  if (h > 24 || m > 59) return null;
  const ap = ampm?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  else if (ap === 'am' && h === 12) h = 0;
  else if (!ap && baje && h >= 1 && h <= 6) h += 12;
  return `${pad(h)}:${pad(m)}`;
}

function extractTimes(s: string): { times: string[]; rest: string } {
  const times: string[] = [];
  const add = (t: string | null) => {
    if (t) times.push(t);
  };
  let rest = s;
  rest = rest.replace(/(?<![\d:])(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?(?!\d)/gi, (_m, h, mi, ap) => {
    add(toTime(+h, +mi, ap));
    return ' ';
  });
  rest = rest.replace(/\b(\d{1,2})(?:\.(\d{2}))?\s*(am|pm)\b/gi, (_m, h, mi, ap) => {
    add(toTime(+h, mi ? +mi : 0, ap));
    return ' ';
  });
  rest = rest.replace(/\b(\d{1,2})\s*baje\b/gi, (_m, h) => {
    add(toTime(+h, 0, undefined, true));
    return ' ';
  });
  return { times, rest };
}

function safeJson(o: unknown): string {
  try {
    return JSON.stringify(o) ?? '';
  } catch {
    return '';
  }
}

export function collectFacts(toolOutputs: unknown[], userText: string, contextText: string): FactSet {
  const parts: string[] = toolOutputs.map((o) => (typeof o === 'string' ? o : safeJson(o)));
  parts.push(userText ?? '', contextText ?? '');
  const all = parts.join('\n');
  const numbers = new Set<string>();
  for (const m of all.match(/\d+(?:\.\d+)?/g) ?? []) numbers.add(num(m));
  return {
    numbers,
    times: new Set(extractTimes(all).times),
    haystack: all.normalize('NFC').toLowerCase(),
  };
}

export function splitSentences(text: string): string[] {
  return text
    .split(/\n+|(?<!\bRs\.)(?<=[.!?।])\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function checkSentence(sentence: string, facts: FactSet, dict: EntityDict): string[] {
  const reasons: string[] = [];
  let s = sentence;

  // amounts
  s = s.replace(
    /(?:₹|\brs\.?|\binr)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:rupees?|rs\b|₹)/gi,
    (_m, a, b) => {
      const v = num(a ?? b);
      if (!facts.numbers.has(v)) reasons.push(`amount:${v}`);
      return ' ';
    },
  );

  // times
  const { times, rest } = extractTimes(s);
  for (const t of times) if (!facts.times.has(t)) reasons.push(`time:${t}`);
  s = rest;

  // bare numbers >= 2
  for (const m of s.match(/\d+(?:\.\d+)?/g) ?? []) {
    if (parseFloat(m) >= 2 && !facts.numbers.has(num(m))) reasons.push(`number:${num(m)}`);
  }

  // names
  for (const n of dict.findMentions(sentence)) {
    if (!facts.haystack.includes(n)) reasons.push(`name:${n}`);
  }
  return reasons;
}

export function checkGrounding(
  text: string,
  facts: FactSet,
  dict: EntityDict,
): { text: string; dropped: number; reasons: string[] } {
  const kept: string[] = [];
  const reasons: string[] = [];
  let dropped = 0;
  for (const sentence of splitSentences(text)) {
    const r = checkSentence(sentence, facts, dict);
    if (r.length) {
      dropped++;
      reasons.push(...r);
    } else kept.push(sentence);
  }
  return { text: kept.join(' '), dropped, reasons };
}

export type Fallback = 'caption' | 'not_found' | 'generic' | null;

export function finalizeReply(args: {
  text: string;
  facts: FactSet;
  dict: EntityDict;
  cardCaption?: string;
  allToolsEmpty: boolean;
}): { text: string; dropped: number; reasons: string[]; fallback: Fallback } {
  const g = checkGrounding(args.text, args.facts, args.dict);
  if (g.text.trim()) return { ...g, fallback: null };
  if (args.cardCaption) return { ...g, text: args.cardCaption, fallback: 'caption' };
  if (args.allToolsEmpty) return { ...g, text: NOT_FOUND, fallback: 'not_found' };
  return { ...g, text: GENERIC, fallback: 'generic' };
}
