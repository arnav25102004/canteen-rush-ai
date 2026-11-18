import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { AppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { RefMap } from '../refs';
import { AssistantCard } from '../cards';
import { ToolDef as ProviderToolDef } from '../provider/types';

/**
 * Everything a tool may know about the caller. It comes from the authenticated request and the
 * database, never from model arguments: no tool takes a user, institution or role argument.
 */
export interface ToolCtx {
  userId: string;
  institutionId: string;
  role: UserRole;
  /** The profile diet ("veg", "nonveg", "jain", "noegg") or null. */
  diet: string | null;
  conversationId: string | null;
  refs: RefMap;
  now: Date;
}

export interface ToolRunResult {
  /** Compact JSON the model reads (wrapped as data). */
  data: unknown;
  /** Server-built card for the app (terminal tools). */
  card?: AssistantCard;
  /** Extra strings the reply may mention (grounding). */
  facts?: string[];
  /** Short suggestion chips (at most 2). */
  followups?: string[];
}

export interface ToolDefinition<A extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  args: A;
  timeoutMs: number;
  maxResultBytes: number;
  terminal: boolean;
  run(ctx: ToolCtx, args: z.output<A>): Promise<ToolRunResult>;
}

export const DEFAULT_TOOL_TIMEOUT_MS = 3000;
export const DEFAULT_MAX_RESULT_BYTES = 4096;
export const MAX_NAME_CHARS = 60;
export const MAX_DESCRIPTION_CHARS = 100;

export function defineTool<A extends z.ZodType>(def: {
  name: string;
  description: string;
  args: A;
  timeoutMs?: number;
  maxResultBytes?: number;
  terminal?: boolean;
  run(ctx: ToolCtx, args: z.output<A>): Promise<ToolRunResult>;
}): ToolDefinition<A> {
  if (def.description.trim().split(/\s+/).length > 15) {
    throw new Error(`tool ${def.name}: description must be 15 words or fewer`);
  }
  return {
    name: def.name,
    description: def.description,
    args: def.args,
    timeoutMs: def.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
    maxResultBytes: def.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES,
    terminal: def.terminal ?? false,
    run: def.run,
  };
}

export type ToolRegistry = ReadonlyMap<string, ToolDefinition>;

export function createRegistry(tools: ToolDefinition<any>[]): ToolRegistry {
  const map = new Map<string, ToolDefinition>();
  for (const t of tools) {
    if (map.has(t.name)) throw new Error(`duplicate tool ${t.name}`);
    map.set(t.name, t);
  }
  return map;
}

/** Tool definitions in the provider's format; the JSON schema comes from the zod args. */
export function toProviderTools(tools: ToolDefinition<any>[]): ProviderToolDef[] {
  return tools.map((t) => {
    const { $schema: _drop, ...schema } = z.toJSONSchema(t.args, { io: 'input' }) as Record<string, unknown>;
    return { name: t.name, description: t.description, parameters: schema };
  });
}

function clipString(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Clips vendor-written strings (names to 60 chars, anything else to 100) anywhere in a result. */
function clipVendorText(value: unknown, key?: string): unknown {
  if (typeof value === 'string') return clipString(value, key === 'description' ? MAX_DESCRIPTION_CHARS : key === 'name' ? MAX_NAME_CHARS : MAX_DESCRIPTION_CHARS);
  if (Array.isArray(value)) return value.map((v) => clipVendorText(v));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clipVendorText(v, k)]));
  }
  return value;
}

/** Item and canteen names go into rows as plain strings; clip them the same way. */
export function clipName(s: string): string {
  return clipString(s, MAX_NAME_CHARS);
}

function escapeDataTag(json: string): string {
  return json.replace(/<\/data/gi, '<\\/data');
}

/**
 * Wraps a tool result as `<data kind="tool_result" tool="x">{json}</data>`. Vendor text is clipped,
 * a closing data tag inside the JSON is escaped so it cannot end the block early, and a result over
 * the byte cap loses rows from the end (reported in "more").
 */
export function wrapToolResult(tool: string, data: unknown, maxBytes: number = DEFAULT_MAX_RESULT_BYTES): string {
  let value = clipVendorText(data) as unknown;
  let json = JSON.stringify(value) ?? 'null';
  if (Buffer.byteLength(json) > maxBytes && value && typeof value === 'object' && Array.isArray((value as { rows?: unknown }).rows)) {
    const obj = { ...(value as { rows: unknown[]; more?: number }) };
    const rows = [...obj.rows];
    let dropped = 0;
    while (rows.length > 0 && Buffer.byteLength(JSON.stringify({ ...obj, rows, more: (obj.more ?? 0) + dropped })) > maxBytes) {
      rows.pop();
      dropped++;
    }
    value = { ...obj, rows, more: (obj.more ?? 0) + dropped };
    json = JSON.stringify(value);
  }
  if (Buffer.byteLength(json) > maxBytes) json = JSON.stringify({ error: 'result too large' });
  return `<data kind="tool_result" tool="${tool.replace(/[^a-z0-9_]/gi, '')}">${escapeDataTag(json)}</data>`;
}

export interface ToolOutcome {
  name: string;
  ok: boolean;
  /** Wrapped text to put in the tool message. */
  content: string;
  status: 'ok' | 'error' | 'timeout' | 'invalid' | 'unknown_tool' | 'internal';
  terminal: boolean;
  card?: AssistantCard;
  facts?: string[];
  followups?: string[];
  /** Raw (unwrapped) data, for the grounding facts. */
  data?: unknown;
  latencyMs: number;
  resultBytes: number;
}

function errorOutcome(name: string, status: ToolOutcome['status'], message: string, started: number): ToolOutcome {
  const content = wrapToolResult(name, { error: message });
  return { name, ok: false, content, status, terminal: false, latencyMs: Date.now() - started, resultBytes: Buffer.byteLength(content) };
}

/**
 * Runs one model-requested tool. Deny by default: an unknown name is an error result. Arguments
 * are parsed with zod and a failure goes back to the model as text. A tool is cut off at its
 * timeout. An AppError message is passed through; any other error becomes {error:"internal"}.
 */
export async function executeTool(registry: ToolRegistry, ctx: ToolCtx, name: string, rawArgs: string): Promise<ToolOutcome> {
  const started = Date.now();
  const tool = registry.get(name);
  if (!tool) return errorOutcome(String(name).slice(0, 40), 'unknown_tool', 'unknown tool', started);

  let parsedJson: unknown;
  try {
    parsedJson = rawArgs && rawArgs.trim() ? JSON.parse(rawArgs) : {};
  } catch {
    return errorOutcome(name, 'invalid', 'arguments are not valid JSON', started);
  }
  const parsed = tool.args.safeParse(parsedJson);
  if (!parsed.success) {
    return errorOutcome(name, 'invalid', `invalid arguments: ${JSON.stringify(z.flattenError(parsed.error))}`, started);
  }

  let timer: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      tool.run(ctx, parsed.data),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ToolTimeout()), tool.timeoutMs);
      }),
    ]);
    const content = wrapToolResult(name, result.data, tool.maxResultBytes);
    return {
      name,
      ok: true,
      content,
      status: 'ok',
      terminal: tool.terminal,
      card: result.card,
      facts: result.facts,
      followups: result.followups?.slice(0, 2),
      data: result.data,
      latencyMs: Date.now() - started,
      resultBytes: Buffer.byteLength(content),
    };
  } catch (err) {
    if (err instanceof ToolTimeout) return errorOutcome(name, 'timeout', 'tool timed out', started);
    if (err instanceof AppError) return errorOutcome(name, 'error', err.message, started);
    logger.error('assistant tool failed', { tool: name, error: (err as Error)?.message });
    return errorOutcome(name, 'internal', 'internal', started);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

class ToolTimeout extends Error {}
