// Dictionary of canteen and item names, used by the grounding check. Pure; no DB import.

export interface EntityLoader {
  /** Returns every canteen and item name visible to the institution. */
  load(): Promise<string[]>;
}

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

export class EntityDict {
  readonly names: string[];

  constructor(names: string[]) {
    const set = new Set<string>();
    for (const n of names) {
      const v = String(n).normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
      if (v.length >= 3) set.add(v);
    }
    this.names = [...set].sort((a, b) => b.length - a.length || a.localeCompare(b));
  }

  /** Lowercased names mentioned in text (word-bounded, longest first, non-overlapping). */
  findMentions(text: string): string[] {
    const hay = text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
    const taken: boolean[] = new Array(hay.length).fill(false);
    const found: string[] = [];
    for (const name of this.names) {
      let from = 0;
      let hit = false;
      while (true) {
        const i = hay.indexOf(name, from);
        if (i < 0) break;
        from = i + 1;
        const end = i + name.length;
        if (isWordChar(hay[i - 1]) || isWordChar(hay[end])) continue;
        if (taken.slice(i, end).some(Boolean)) continue;
        for (let k = i; k < end; k++) taken[k] = true;
        hit = true;
      }
      if (hit) found.push(name);
    }
    return found;
  }
}

export const ENTITY_TTL_MS = 5 * 60 * 1000;

/** Wraps a loader with a TTL refresh. Keeps stale data if a refresh fails. */
export class CachedEntityDict {
  private dict: EntityDict | null = null;
  private loadedAt = 0;
  private inflight: Promise<EntityDict> | null = null;

  constructor(
    private readonly loader: EntityLoader,
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = ENTITY_TTL_MS,
  ) {}

  async get(): Promise<EntityDict> {
    if (this.dict && this.now() - this.loadedAt < this.ttlMs) return this.dict;
    if (!this.inflight) {
      this.inflight = this.loader
        .load()
        .then((names) => {
          this.dict = new EntityDict(names);
          this.loadedAt = this.now();
          return this.dict;
        })
        .catch((err) => {
          if (this.dict) return this.dict; // stale beats nothing
          throw err;
        })
        .finally(() => {
          this.inflight = null;
        });
    }
    return this.inflight;
  }
}
