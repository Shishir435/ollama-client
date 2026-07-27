import { describe, expect, it, vi } from "vitest"
import browser from "@/lib/browser-api"
import {
  assertSyncStorageQuota,
  type SyncStorageQuotaError
} from "@/lib/storage/sync-quota"

describe("sync storage quota guard", () => {
  it("rejects values above the 8 KiB per-item limit before write", async () => {
    await expect(
      assertSyncStorageQuota("large-setting", "x".repeat(9_000))
    ).rejects.toMatchObject({
      name: "SyncStorageQuotaError",
      key: "large-setting",
      kind: "item",
      limitBytes: 8_192
    } satisfies Partial<SyncStorageQuotaError>)
  })

  it("rejects writes that would exceed total sync quota", async () => {
    const sync = browser.storage.sync as typeof browser.storage.sync & {
      getBytesInUse: (keys: string | string[] | null) => Promise<number>
    }
    const getBytesInUse = vi.fn(async (keys: string | string[] | null) =>
      keys === null ? 102_390 : 5
    )
    sync.getBytesInUse = getBytesInUse

    await expect(
      assertSyncStorageQuota("new-setting", "value")
    ).rejects.toMatchObject({ kind: "total", limitBytes: 102_400 })
    delete (sync as { getBytesInUse?: unknown }).getBytesInUse
  })
})
