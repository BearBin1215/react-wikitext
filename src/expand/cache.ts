/** 缓存容量统计；跨编译累计，`clear` 会重置。 */
export interface WikitextCacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly entries: number;
  readonly bytes: number;
}

/**
 * 同时限制条目数与占用字节的 LRU。
 *
 * 条目大小由调用方提供；超过字节上限的单条结果可以返回但不入缓存。
 */
export class WikitextLruCache<Value> {
  private readonly entries = new Map<string, { value: Value; size: number }>();
  private bytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number,
    private readonly sizeOf: (value: Value) => number,
  ) {}

  get(key: string): Value | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    // Map 保持插入顺序；重新插入把命中的条目移到末尾。
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits++;
    return entry.value;
  }

  /** 只查询、不计入命中统计；用于并发任务去重。 */
  peek(key: string): Value | undefined {
    return this.entries.get(key)?.value;
  }

  set(key: string, value: Value): void {
    const size = this.sizeOf(value);
    if (!Number.isSafeInteger(size) || size < 0) {
      return;
    }
    if (size > this.maxBytes) {
      return;
    }
    const existing = this.entries.get(key);
    if (existing) {
      this.bytes -= existing.size;
      this.entries.delete(key);
    }
    this.entries.set(key, { value, size });
    this.bytes += size;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next();
      if (oldest.done) {
        break;
      }
      this.evict(oldest.value);
    }
  }

  delete(key: string): void {
    const existing = this.entries.get(key);
    if (existing) {
      this.bytes -= existing.size;
      this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  get stats(): WikitextCacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      entries: this.entries.size,
      bytes: this.bytes,
    };
  }

  private evict(key: string): void {
    const existing = this.entries.get(key);
    if (!existing) {
      return;
    }
    this.bytes -= existing.size;
    this.entries.delete(key);
    this.evictions++;
  }
}
