import browser from "@/lib/browser-api"

const SYNC_QUOTA_BYTES = 102_400
const SYNC_QUOTA_BYTES_PER_ITEM = 8_192

const bytes = (value: string): number => new TextEncoder().encode(value).length

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

  const sync = browser.storage?.sync
  if (typeof sync?.getBytesInUse !== "function") return
  const [total, current] = await Promise.all([
    sync.getBytesInUse(null),
    sync.getBytesInUse(key)
  ])
  const predicted = total - current + itemBytes
  if (predicted > SYNC_QUOTA_BYTES) {
    throw new SyncStorageQuotaError(key, "total", predicted, SYNC_QUOTA_BYTES)
  }
}
