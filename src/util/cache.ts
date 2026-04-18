import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LRUCache } from "lru-cache";
import { superzHome } from "./paths.js";
import { tagged } from "./logger.js";

const log = tagged("cache");

export interface CacheEntry {
  compressed: string;
  provider: string;
  createdAt: number;
}

export interface CompressionCacheOptions {
  maxEntries?: number;
  ttlMs?: number;
  persistent?: boolean;
}

/**
 * Two-tier cache: hot in-memory LRU backed by a simple file-per-hash
 * disk store. Key = sha256(normalized prompt + system prompt version
 * + provider set version). Disk cache survives process restarts.
 */
export class CompressionCache {
  private readonly memory: LRUCache<string, CacheEntry>;
  private readonly dir: string;
  private readonly persistent: boolean;

  constructor(opts: CompressionCacheOptions = {}) {
    this.memory = new LRUCache<string, CacheEntry>({
      max: opts.maxEntries ?? 500,
      ttl: opts.ttlMs ?? 1000 * 60 * 60 * 24 * 7,
    });
    this.persistent = opts.persistent ?? true;
    this.dir = superzHome("cache");
    if (this.persistent && !existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  static key(input: { prompt: string; systemPromptVersion: string; providerSetVersion: string }): string {
    const normalized = input.prompt.replace(/\s+/g, " ").trim();
    return createHash("sha256")
      .update(`${input.systemPromptVersion}\x00${input.providerSetVersion}\x00${normalized}`)
      .digest("hex");
  }

  get(key: string): CacheEntry | undefined {
    const hit = this.memory.get(key);
    if (hit) return hit;
    if (!this.persistent) return undefined;
    const path = join(this.dir, `${key}.json`);
    if (!existsSync(path)) return undefined;
    try {
      const raw = readFileSync(path, "utf8");
      const entry = JSON.parse(raw) as CacheEntry;
      this.memory.set(key, entry);
      return entry;
    } catch (err) {
      log.debug("Failed to read cache entry", key, err);
      return undefined;
    }
  }

  set(key: string, entry: CacheEntry): void {
    this.memory.set(key, entry);
    if (!this.persistent) return;
    try {
      writeFileSync(join(this.dir, `${key}.json`), JSON.stringify(entry, null, 2), "utf8");
    } catch (err) {
      log.debug("Failed to persist cache entry", key, err);
    }
  }
}
