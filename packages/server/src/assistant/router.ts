import { AssistantCard } from './cards';
import { ToolDefinition } from './tools/registry';
import { toolRegistry } from './tools';

export const MAX_OFFERED_TOOLS = 4;

const POINTS = /\b(points?|loyalty|rewards?|redeem|coins?)\b/i;
const STATUS_REPEAT = /\b(last order|previous order|my orders?|order status|same (?:as|again)|repeat|usual|again|pichla|pichli|pehle jaisa|waisa hi|wahi)\b/i;
const ORDER_VERB = /\b(order|want|wanna|need|get me|buy|book|add|chahiye|chahie|dena|de do|dedo|mangta|mangwa|lena|le lo|lelo|bhej|banao|bana do)\b/i;
const QTY_START = /^\s*\d+\s+\p{L}/u;
const TIME_MENTION = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm|baje)\b/i;
const BROWSE =
  /\b(suggest|recommend|popular|best|cheap|under|below|less than|kya hai|kya milega|menu|show|options?|something|kuch|spicy|sweet|quick|fast|veg|nonveg|snack|drinks?|lunch|breakfast|dinner|khana|price|kitna|kitne|how much|open|hours|timing)\b/i;

const pick = (...names: string[]): ToolDefinition[] =>
  names.map((n) => toolRegistry.get(n)).filter((t): t is ToolDefinition => !!t).slice(0, MAX_OFFERED_TOOLS);

/**
 * Chooses which tools to OFFER this turn (at most 4) from a few English/Hinglish cues. It never
 * blocks anything: a tool that is not offered is simply not callable this turn. Fewer tool
 * definitions means fewer prompt tokens.
 */
export function selectTools(text: string, lastCard?: AssistantCard | null): ToolDefinition[] {
  const t = String(text ?? '');
  if (POINTS.test(t)) return pick('get_my_points', 'get_recommendations');
  if (STATUS_REPEAT.test(t)) return pick('get_my_recent_orders', 'find_slots', 'propose_order', 'search_menu');
  if (ORDER_VERB.test(t) || QTY_START.test(t) || TIME_MENTION.test(t)) {
    return pick('search_menu', 'find_slots', 'propose_order', 'get_canteen_menu');
  }
  if (BROWSE.test(t)) return pick('search_menu', 'get_recommendations', 'show_items', 'get_canteen_menu');
  if (lastCard && t.trim().split(/\s+/).length <= 8) {
    return lastCard.type === 'order_proposal'
      ? pick('find_slots', 'propose_order', 'search_menu')
      : pick('propose_order', 'find_slots', 'search_menu', 'show_items');
  }
  return pick('search_menu', 'get_canteen_menu', 'get_recommendations', 'show_items');
}
