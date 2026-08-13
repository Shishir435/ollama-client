const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000
const MAX_ENTRIES = 100

type WarmupEntry = {
  eligibleAt: number
}

/**
 * A bounded, restart-local suppression cache for model warmups.
 *
 * Losing this cache during an MV3 worker restart can only cause another
 * harmless warmup request. Persisting it would turn advisory optimization
 * state into a durable write path, so restart loss is deliberate.
 */
export class ModelWarmupCache {
  private readonly entries = new Map<string, WarmupEntry>()

  shouldWarmup(key: string, keepAliveMs?: number, now = Date.now()): boolean {
    if (keepAliveMs === 0) return false

    const entry = this.entries.get(key)
    if (!entry) return true
    if (now <= entry.eligibleAt) return false

    this.entries.delete(key)
    return true
  }

  record(key: string, keepAliveMs?: number, now = Date.now()): void {
    const cooldownMs = keepAliveMs ?? DEFAULT_COOLDOWN_MS
    const entry = { eligibleAt: now + cooldownMs / 2 }

    // Refreshing a key also refreshes its insertion order for FIFO eviction.
    this.entries.delete(key)
    this.entries.set(key, entry)

    const oldestKey = this.entries.keys().next().value
    if (this.entries.size > MAX_ENTRIES && oldestKey !== undefined) {
      this.entries.delete(oldestKey)
    }
  }
}
