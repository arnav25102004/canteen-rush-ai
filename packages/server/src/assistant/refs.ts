import { prisma } from '../config/database';
import { AppError } from '../utils/errors';

export type RefKind = 'c' | 'm' | 's' | 'p';
export const MAX_REFS = 300;
export const UNKNOWN_REF_MESSAGE = 'unknown ref; search first';

const HANDLE = /^([cmsp])([1-9]\d{0,3})$/;

/**
 * Short handles (c1 canteen, m4 menu item, s2 slot, p1 proposal) the model uses instead of
 * UUIDs. Append-only and capped, stored per conversation, so a handle never changes meaning.
 */
export class RefMap {
  private byHandle = new Map<string, string>();
  private byId = new Map<string, string>();
  private counters: Record<RefKind, number> = { c: 0, m: 0, s: 0, p: 0 };
  private dirty = false;

  static fromJson(json: unknown): RefMap {
    const map = new RefMap();
    if (json && typeof json === 'object' && !Array.isArray(json)) {
      for (const [handle, id] of Object.entries(json as Record<string, unknown>)) {
        const m = HANDLE.exec(handle);
        if (!m || typeof id !== 'string' || map.byHandle.size >= MAX_REFS) continue;
        map.byHandle.set(handle, id);
        map.byId.set(`${m[1]}:${id}`, handle);
        map.counters[m[1] as RefKind] = Math.max(map.counters[m[1] as RefKind], Number(m[2]));
      }
    }
    return map;
  }

  toJson(): Record<string, string> {
    return Object.fromEntries(this.byHandle);
  }

  get size() {
    return this.byHandle.size;
  }

  get isDirty() {
    return this.dirty;
  }

  /** The handle for an id, minted on first use. Throws when the conversation's ref cap is reached. */
  ref(kind: RefKind, uuid: string): string {
    const existing = this.byId.get(`${kind}:${uuid}`);
    if (existing) return existing;
    if (this.byHandle.size >= MAX_REFS) throw new AppError(400, 'too many references in this chat; start a new chat');
    const handle = `${kind}${++this.counters[kind]}`;
    this.byHandle.set(handle, uuid);
    this.byId.set(`${kind}:${uuid}`, handle);
    this.dirty = true;
    return handle;
  }

  /** The id behind a handle of the expected kind. An unknown or wrong-kind handle is a tool error. */
  resolve(handle: string, kind: RefKind): string {
    const h = String(handle ?? '').trim().toLowerCase();
    const m = HANDLE.exec(h);
    if (!m || m[1] !== kind) throw new AppError(400, UNKNOWN_REF_MESSAGE);
    const id = this.byHandle.get(h);
    if (!id) throw new AppError(400, UNKNOWN_REF_MESSAGE);
    return id;
  }

  static async load(conversationId: string, userId: string): Promise<RefMap> {
    const row = await prisma.assistantConversation.findFirst({ where: { id: conversationId, userId }, select: { refs: true } });
    return RefMap.fromJson(row?.refs);
  }

  /** Writes the map back (only the owner's conversation). No-op when nothing was added. */
  async save(conversationId: string, userId: string): Promise<void> {
    if (!this.dirty) return;
    await prisma.assistantConversation.updateMany({ where: { id: conversationId, userId }, data: { refs: this.toJson() } });
    this.dirty = false;
  }
}
