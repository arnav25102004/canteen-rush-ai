import { Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { validateBody } from '../utils/helpers';
import { logger } from '../utils/logger';
import { AssistantCard } from '../assistant/cards';
import { buildChips, Chip, chipFor, chipLang, menuChip, turnActionSchema } from '../assistant/chips';
import { runChipAction } from '../assistant/chipActions';
import { AssistantConfig, loadAssistantConfig } from '../assistant/config';
import { loadContext, TurnContext } from '../assistant/context';
import { CachedEntityDict, EntityDict, EntityLoader } from '../assistant/entityDict';
import { AssistantError } from '../assistant/errors';
import { collectFacts, finalizeReply } from '../assistant/grounding';
import { acquireTurnLock, findExistingTurn, getOrCreateConversation, loadHistoryForModel, releaseTurnLock, saveTurn, StoredReply } from '../assistant/history';
import { normalizeInput } from '../assistant/inputGuard';
import { TurnLedger } from '../assistant/ledger';
import { captionFor, runTurn } from '../assistant/loop';
import { getUsageToday, giveBackTurn, MAX_TURNS_PER_USER, reserveTurn } from '../assistant/budget';
import { guardOutput } from '../assistant/outputGuard';
import { buildContextMessage } from '../assistant/prompt';
import { createOpenAICompatibleProvider } from '../assistant/provider/openaiCompatible';
import { AssistantUnavailableError, Provider } from '../assistant/provider/types';
import { selectTools } from '../assistant/router';
import { preScreen, REFUSAL } from '../assistant/scope';
import { toolRegistry } from '../assistant/tools';
import { ToolRegistry } from '../assistant/tools/registry';

export const BUSY_REPLY = 'The assistant is busy right now. You can still order from the menu.';
export const DAILY_LIMIT_MESSAGE = "You've used all of today's assistant turns. You can still order from the menu.";

export interface AssistantDeps {
  provider: () => Provider;
  registry: ToolRegistry;
  config: () => AssistantConfig;
  entityDict: (institutionId: string) => Promise<EntityDict>;
}

const dicts = new Map<string, CachedEntityDict>();

/** Every canteen and item name of the institution, refreshed every 5 minutes. */
function prismaEntityLoader(institutionId: string): EntityLoader {
  return {
    async load() {
      const [canteens, items] = await Promise.all([
        prisma.canteen.findMany({ where: { institutionId }, select: { name: true } }),
        prisma.menuItem.findMany({ where: { canteen: { institutionId } }, select: { name: true }, take: 5000 }),
      ]);
      return [...canteens.map((c) => c.name), ...items.map((i) => i.name)];
    },
  };
}

let providerInstance: Provider | null = null;
export let deps: AssistantDeps = {
  provider: () => {
    if (!providerInstance) {
      const cfg = loadAssistantConfig();
      providerInstance = createOpenAICompatibleProvider({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey ?? '' });
    }
    return providerInstance;
  },
  registry: toolRegistry,
  config: () => loadAssistantConfig(),
  async entityDict(institutionId) {
    let d = dicts.get(institutionId);
    if (!d) {
      d = new CachedEntityDict(prismaEntityLoader(institutionId));
      dicts.set(institutionId, d);
    }
    try {
      return await d.get();
    } catch (err) {
      logger.warn('assistant entity dictionary failed (numbers and times are still checked)', { error: (err as Error)?.message });
      return new EntityDict([]);
    }
  },
};

/** Test hook: replaces the provider, registry, config or dictionary. */
export function setAssistantDeps(next: Partial<AssistantDeps>) {
  deps = { ...deps, ...next };
}

const turnBody = z
  .object({
    conversationId: z.string().uuid().optional(),
    clientTurnId: z.string().uuid(),
    message: z.string().max(500).optional(),
    action: turnActionSchema.optional(),
  })
  .refine((b) => (b.message !== undefined) !== (b.action !== undefined), { message: 'send exactly one of message or action' });

const INPUT_ERRORS: Record<string, string> = {
  empty: 'Type a message first.',
  too_long: 'That message is too long. Keep it under 500 characters.',
  too_many_lines: 'That message has too many lines.',
  invalid: 'That message could not be read.',
};

async function turnsLeftToday(userId: string): Promise<number> {
  try {
    const u = await getUsageToday(userId);
    return Math.max(0, MAX_TURNS_PER_USER - u.turns);
  } catch {
    return 0;
  }
}

async function hasEarlierOrder(userId: string): Promise<boolean> {
  try {
    return !!(await prisma.order.findFirst({ where: { userId, status: { not: 'CANCELLED' } }, select: { id: true } }));
  } catch {
    return false;
  }
}

interface FinishedReply {
  text: string;
  cards: AssistantCard[];
  chips: Chip[];
  outcome: string;
  degraded?: boolean;
}

function sendError(res: Response, err: AssistantError) {
  return res.status(err.status).json({ error: err.message, code: err.code });
}

/**
 * POST /api/assistant/turn. Order: validate and clean the input, refuse clearly off-topic text
 * (0 tokens, not counted), return a stored reply for a retried clientTurnId, take the
 * per-conversation lock, then run a chip action in code or the model turn
 * (reserve quota, load context, route tools, run the loop, output guard, grounding, chips).
 * The reply is saved, the ledger written and the lock released in `finally`.
 */
export async function postTurn(req: AuthRequest, res: Response) {
  const parsed = validateBody(turnBody, req.body, res);
  if (!parsed.success) return;
  const { conversationId, clientTurnId, message, action } = parsed.data;
  const user = req.user!;
  const cfg = deps.config();

  let userText: string;
  if (message !== undefined) {
    const n = normalizeInput(message);
    if (!n.ok) return res.status(400).json({ error: INPUT_ERRORS[n.reason] ?? INPUT_ERRORS.invalid, code: 'INVALID_MESSAGE' });
    userText = n.text;
  } else {
    userText = chipFor(action!.type, 'en').label;
  }

  const conv = await getOrCreateConversation(user.id, conversationId);
  const ledger = new TurnLedger(user.id, conv.id);
  const started = Date.now();

  const respond = async (reply: FinishedReply, extra: { promptTokens?: number; completionTokens?: number; groundingDrops?: number } = {}) => {
    const id = await saveTurn({ conversationId: conv.id, clientTurnId, userText, reply, outcome: reply.outcome });
    ledger.turn({ status: reply.outcome, latencyMs: Date.now() - started, ...extra });
    return res.json({
      conversationId: conv.id,
      reply: { id, text: reply.text, cards: reply.cards, chips: reply.chips },
      ...(reply.degraded ? { degraded: true } : {}),
      usage: { turnsLeftToday: await turnsLeftToday(user.id) },
    });
  };

  try {
    // 1. Clearly off-topic text is refused for free. It is not counted against the daily limit.
    if (message !== undefined && preScreen(userText) === 'refuse') {
      return await respond({ text: REFUSAL, cards: [], chips: [], outcome: 'refused_prefilter' });
    }

    // 2. A retry returns the stored reply.
    const replay = async (r: StoredReply) =>
      res.json({
        conversationId: conv.id,
        reply: { id: r.id, text: r.text, cards: r.cards, chips: r.chips },
        usage: { turnsLeftToday: await turnsLeftToday(user.id) },
      });
    const existing = await findExistingTurn(conv.id, clientTurnId);
    if (existing) return await replay(existing);

    // 3. One turn at a time per conversation.
    await acquireTurnLock(conv.id);
    try {
      const again = await findExistingTurn(conv.id, clientTurnId);
      if (again) return await replay(again);

      if (action) {
        const ctx = await loadContext(user, { refs: conv.refs, conversationId: conv.id });
        const r = await runChipAction(ctx, conv, action);
        await conv.refs.save(conv.id, user.id);
        const chips = buildChips({ cards: r.cards, lastUserText: null }, ctx, await hasEarlierOrder(user.id));
        return await respond({ text: r.text, cards: r.cards, chips, outcome: r.outcome });
      }

      const reserve = await reserveTurn(user.id, cfg);
      if (!reserve.ok) {
        if (reserve.reason === 'user_limit') throw new AssistantError(429, 'DAILY_LIMIT', DAILY_LIMIT_MESSAGE);
        return await respond({ text: BUSY_REPLY, cards: [], chips: [menuChip(chipLang(userText))], outcome: 'degraded', degraded: true });
      }

      let ctx: TurnContext;
      let turn: Awaited<ReturnType<typeof runTurn>>;
      try {
        ctx = await loadContext(user, { refs: conv.refs, conversationId: conv.id });
        const history = await loadHistoryForModel(conv.id, 4);
        turn = await runTurn({ provider: deps.provider(), registry: deps.registry, ledger, cfg }, ctx, history.messages, userText, {
          tools: selectTools(userText, history.lastCard),
          userTokensToday: reserve.userTokensToday,
          globalTokensToday: reserve.globalTokensToday,
        });
      } catch (err) {
        // The student got no answer, so the turn is not counted.
        await giveBackTurn(user.id);
        if (err instanceof AssistantUnavailableError) {
          logger.warn('assistant unavailable', { reason: err.reason, attempts: err.attempts });
          return await respond({ text: BUSY_REPLY, cards: [], chips: [menuChip(chipLang(userText))], outcome: 'degraded', degraded: true });
        }
        throw err;
      }
      await conv.refs.save(conv.id, user.id).catch((e) => logger.warn('assistant refs save failed', { error: (e as Error)?.message }));

      // 4. Guards, then grounding. Cards come from the database; only the sentence is checked.
      const guard = guardOutput(turn.text, { toolsCalled: turn.toolsCalled });
      let text = guard.text;
      let outcome: string = guard.outcome === 'refused_guard' ? 'refused_guard' : turn.capped ? `capped_${turn.capped}` : 'ok';
      let cards = turn.cards;
      let groundingDrops = 0;
      if (guard.outcome === 'refused_guard') {
        cards = [];
      } else {
        const dict = await deps.entityDict(ctx.institutionId);
        const facts = collectFacts(turn.factSources, userText, buildContextMessage(ctx).content);
        const fin = finalizeReply({
          text,
          facts,
          dict,
          cardCaption: cards[0] ? captionFor(cards[0]) : undefined,
          allToolsEmpty: turn.allToolsEmpty,
        });
        text = fin.text;
        groundingDrops = fin.dropped;
        if (fin.dropped > 0) logger.info('assistant grounding drops', { dropped: fin.dropped, reasons: fin.reasons.slice(0, 6) });
      }
      const chips = buildChips({ cards, lastUserText: userText }, ctx, await hasEarlierOrder(user.id));
      return await respond(
        { text, cards, chips, outcome },
        { promptTokens: turn.tokens.prompt, completionTokens: turn.tokens.completion, groundingDrops },
      );
    } finally {
      await releaseTurnLock(conv.id).catch((e) => logger.warn('assistant lock release failed', { error: (e as Error)?.message }));
    }
  } catch (err) {
    if (err instanceof AssistantError) return sendError(res, err);
    throw err;
  } finally {
    await ledger.flush();
  }
}

/** GET /api/assistant/conversations/current: the latest chat's last 50 messages. */
export async function getCurrentConversation(req: AuthRequest, res: Response) {
  const conv = await prisma.assistantConversation.findFirst({
    where: { userId: req.user!.id },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, busyUntil: true },
  });
  if (!conv) return res.json({ conversationId: null, busy: false, messages: [] });
  const rows = await prisma.assistantMessage.findMany({
    where: { conversationId: conv.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, role: true, text: true, cards: true, chips: true, clientTurnId: true, createdAt: true },
  });
  return res.json({
    conversationId: conv.id,
    busy: !!conv.busyUntil && conv.busyUntil.getTime() > Date.now(),
    messages: rows.reverse().map((m) => ({
      id: m.id,
      role: m.role,
      text: m.text,
      cards: Array.isArray(m.cards) ? m.cards : [],
      chips: Array.isArray(m.chips) ? m.chips : [],
      clientTurnId: m.clientTurnId,
      createdAt: m.createdAt,
    })),
  });
}

/** POST /api/assistant/conversations: a new chat with fresh refs. */
export async function createConversation(req: AuthRequest, res: Response) {
  const created = await prisma.assistantConversation.create({ data: { userId: req.user!.id }, select: { id: true } });
  return res.status(201).json({ conversationId: created.id });
}

/** DELETE /api/assistant/conversations: deletes all of the student's chats (messages cascade). */
export async function deleteConversations(req: AuthRequest, res: Response) {
  const out = await prisma.assistantConversation.deleteMany({ where: { userId: req.user!.id } });
  return res.json({ deleted: out.count });
}

const reportBody = z.object({
  reason: z.enum(['OFFENSIVE', 'WRONG_INFO', 'OFF_TOPIC', 'OTHER']),
  note: z.string().max(500).optional(),
});

/** POST /api/assistant/messages/:id/report. Stores the reason and the student's note, never the message text. */
export async function reportMessage(req: AuthRequest, res: Response) {
  const parsed = validateBody(reportBody, req.body, res);
  if (!parsed.success) return;
  const userId = req.user!.id;
  const message = await prisma.assistantMessage.findFirst({
    where: { id: String(req.params.id), role: 'ASSISTANT', conversation: { userId } },
    select: { id: true },
  });
  if (!message) return res.status(404).json({ error: 'Message not found' });
  const note = parsed.data.note?.trim();
  await prisma.$transaction([
    prisma.assistantMessage.updateMany({ where: { id: message.id }, data: { reportedAt: new Date() } }),
    prisma.assistantReport.create({ data: { userId, messageId: message.id, reason: note ? `${parsed.data.reason}: ${note}` : parsed.data.reason } }),
  ]);
  return res.status(201).json({ ok: true });
}
