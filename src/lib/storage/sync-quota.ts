import browser from "@/lib/browser-api"
import { logger } from "@/lib/logger"

const SYNC_QUOTA_BYTES = 102_400
const SYNC_QUOTA_BYTES_PER_ITEM = 8_192

const bytes = (value: string): number => new TextEncoder().encode(value).length

/** Once per session: this fires on a write path, and it is a property of the
 * browser, not of the value being written. */
let warnedTotalCheckUnavailable = false

const warnTotalCheckUnavailable = (error: unknown): void => {
  if (warnedTotalCheckUnavailable) return
  warnedTotalCheckUnavailable = true
  logger.warn(
    "Sync total-quota check unavailable; per-item limit still enforced",
    "SyncQuota",
    { error }
  )
}

export class SyncStorageQuotaError extends Error {
  constructor(
    readonly key: string,
    readonly kind: "item" | "total",
    readonly predictedBytes: number,
    readonly limitBytes: number
  ) {
    super(
      `Sync storage ${kind} quota exceeded for ${key}: ${predictedBytes} > ${limitBytes} bytes`
    )
    this.name = "SyncStorageQuotaError"
  }
}

export const assertSyncStorageQuota = async <T>(
  key: string,
  value: T
): Promise<void> => {
  // Plasmo stores JSON.stringify(value) as a string. Browser quota accounting
  // then JSON-serializes that string again.
  const serialized = JSON.stringify(value)
  const itemBytes =
    bytes(JSON.stringify(key)) + bytes(JSON.stringify(serialized))
  if (itemBytes > SYNC_QUOTA_BYTES_PER_ITEM) {
    throw new SyncStorageQuotaError(
      key,
      "item",
      itemBytes,
      SYNC_QUOTA_BYTES_PER_ITEM
    )
  }

  /*
   * The item check above is arithmetic and always runs. The total check needs
   * `getBytesInUse`, which not every browser implements for the sync area —
   * Firefox notably lagged — and which can reject at runtime.
   *
   * This guard sits on every sync write, so it must fail open: a browser that
   * cannot report its usage would otherwise make every settings change throw,
   * turning a safety net into an outage. Skipping means the browser's own
   * quota rejection remains the backstop, which is the behaviour that shipped
   * before this guard existed.
   */
  const sync = browser.storage?.sync
  if (typeof sync?.getBytesInUse !== "function") return

  let predicted: number
  try {
    const [total, current] = await Promise.all([
      sync.getBytesInUse(null),
      sync.getBytesInUse(key)
    ])
    predicted = total - current + itemBytes
  } catch (error) {
    warnTotalCheckUnavailable(error)
    return
  }

  if (predicted > SYNC_QUOTA_BYTES) {
    throw new SyncStorageQuotaError(key, "total", predicted, SYNC_QUOTA_BYTES)
  }
}
