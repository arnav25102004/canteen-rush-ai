import { createHash } from 'crypto';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';

type Row = {
  userId: string | null;
  conversationId: string | null;
  kind: 'LLM' | 'TOOL' | 'TURN';
  name: string;
  status: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  argsSha256: string | null;
  groundingDrops: number;
  resultBytes: number | null;
  toolsOffered: number | null;
};

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Buffers the usage rows of one turn and writes them in one createMany. It holds
 * model/tool names, statuses, latencies, token counts and a hash of tool
 * arguments, never message text or tool results. Flushing never throws.
 */
export class TurnLedger {
  private rows: Row[] = [];

  constructor(private readonly userId: string | null, private readonly conversationId: string | null = null) {}

  private base(kind: Row['kind'], name: string, status: string, latencyMs: number): Row {
    return {
      userId: this.userId,
      conversationId: this.conversationId,
      kind,
      name,
      status,
      latencyMs: Math.max(0, Math.round(latencyMs) || 0),
      promptTokens: 0,
      completionTokens: 0,
      argsSha256: null,
      groundingDrops: 0,
      resultBytes: null,
      toolsOffered: null,
    };
  }

  llm(o: { model: string; status: string; latencyMs: number; promptTokens?: number; completionTokens?: number; toolsOffered?: number }) {
    this.rows.push({
      ...this.base('LLM', o.model, o.status, o.latencyMs),
      promptTokens: o.promptTokens ?? 0,
      completionTokens: o.completionTokens ?? 0,
      toolsOffered: o.toolsOffered ?? null,
    });
  }

  tool(o: { name: string; status: string; latencyMs: number; args?: string; resultBytes?: number }) {
    this.rows.push({
      ...this.base('TOOL', o.name, o.status, o.latencyMs),
      argsSha256: o.args === undefined ? null : sha256(o.args),
      resultBytes: o.resultBytes ?? null,
    });
  }

  turn(o: { status: string; latencyMs: number; promptTokens?: number; completionTokens?: number; groundingDrops?: number }) {
    this.rows.push({
      ...this.base('TURN', 'turn', o.status, o.latencyMs),
      promptTokens: o.promptTokens ?? 0,
      completionTokens: o.completionTokens ?? 0,
      groundingDrops: o.groundingDrops ?? 0,
    });
  }

  get size() {
    return this.rows.length;
  }

  snapshot(): readonly Row[] {
    return this.rows;
  }

  async flush(): Promise<void> {
    if (this.rows.length === 0) return;
    const data = this.rows;
    this.rows = [];
    try {
      await prisma.assistantCallLog.createMany({ data });
    } catch (err) {
      logger.warn('assistant ledger flush failed', { rows: data.length, error: (err as Error)?.message });
    }
  }
}
