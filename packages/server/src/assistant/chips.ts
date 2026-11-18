import { z } from 'zod';
import { AssistantCard } from './cards';

export const MAX_CHIPS = 3;

/** Actions a chip can trigger through POST /turn. `navigate` is handled by the app only. */
export const turnActionSchema = z.object({
  type: z.enum(['reorder_last', 'earliest_slot', 'add_drink', 'popular_now']),
});
export type TurnAction = z.infer<typeof turnActionSchema>;

export const chipActionSchema = z.union([turnActionSchema, z.object({ type: z.literal('navigate'), target: z.enum(['menu']) })]);
export type ChipActionPayload = z.infer<typeof chipActionSchema>;

export interface Chip {
  label: string;
  action: ChipActionPayload;
}

export type ChipLang = 'en' | 'hi';

const LABELS = {
  en: {
    reorder_last: 'Same as last time?',
    earliest_slot: 'Earliest slot?',
    add_drink: 'Add a drink?',
    popular_now: 'Popular now',
    menu: 'Open menu',
  },
  hi: {
    reorder_last: 'पिछली बार जैसा?',
    earliest_slot: 'सबसे जल्दी स्लॉट?',
    add_drink: 'ड्रिंक जोड़ें?',
    popular_now: 'अभी लोकप्रिय',
    menu: 'मेनू खोलें',
  },
} as const;

/** Hindi labels when the student wrote in Devanagari, English otherwise. */
export function chipLang(lastUserText: string | null | undefined): ChipLang {
  return /[ऀ-ॿ]/.test(lastUserText ?? '') ? 'hi' : 'en';
}

export function chipFor(type: TurnAction['type'], lang: ChipLang): Chip {
  return { label: LABELS[lang][type], action: { type } };
}

export function menuChip(lang: ChipLang): Chip {
  return { label: LABELS[lang].menu, action: { type: 'navigate', target: 'menu' } };
}

export interface ChipTurn {
  cards: AssistantCard[];
  degraded?: boolean;
  lastUserText?: string | null;
}

/** Up to 3 chips, built in code only (no model call). */
export function buildChips(turn: ChipTurn, _ctx: unknown, hasLastOrder: boolean): Chip[] {
  const lang = chipLang(turn.lastUserText);
  if (turn.degraded) return [menuChip(lang)];
  const card = turn.cards[0];
  const out: Chip[] = [];
  if (card?.type === 'order_proposal') {
    out.push(chipFor('earliest_slot', lang), chipFor('add_drink', lang));
  } else if (card?.type === 'items') {
    out.push(chipFor('popular_now', lang));
    if (hasLastOrder) out.push(chipFor('reorder_last', lang));
  } else {
    if (hasLastOrder) out.push(chipFor('reorder_last', lang));
    out.push(chipFor('popular_now', lang));
  }
  return out.slice(0, MAX_CHIPS);
}
