import { REFUSAL } from './scope';

export type GuardOutcome = 'ok' | 'refused_guard' | 'clipped';

const MAX_REPLY = 400;
const MAX_UNGROUNDED = 200;

function looksLikeCode(raw: string): boolean {
  if (raw.includes('```')) return true;
  const lines = raw.split('\n');
  if (lines.some((l) => /^\s*(def|class|import|function|const|let|#include|SELECT)\b/.test(l))) return true;
  return lines.filter((l) => /[;{}]\s*$/.test(l)).length >= 3;
}

function clip(text: string): string {
  if (text.length <= MAX_REPLY) return text;
  const head = text.slice(0, MAX_REPLY);
  const m = /[.!?।](?=[^.!?।]*$)/.exec(head);
  if (m && m.index >= 40) return head.slice(0, m.index + 1);
  const sp = head.lastIndexOf(' ');
  return (sp > 40 ? head.slice(0, sp) : head).trimEnd() + '…';
}

export function guardOutput(
  text: string,
  opts: { toolsCalled: number },
): { text: string; outcome: GuardOutcome } {
  let t = String(text ?? '').replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '');
  if (looksLikeCode(t)) return { text: REFUSAL, outcome: 'refused_guard' };

  t = t
    .replace(/https?:\/\/\S+|www\.\S+/gi, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\b[cmsp]\d{1,4}\b/gi, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();

  if (opts.toolsCalled === 0 && t.length > MAX_UNGROUNDED) {
    return { text: REFUSAL, outcome: 'refused_guard' };
  }
  const clipped = clip(t);
  return { text: clipped, outcome: clipped !== t ? 'clipped' : 'ok' };
}
