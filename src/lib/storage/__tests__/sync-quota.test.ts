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

  it("allows the write when the browser cannot report usage", async () => {
    // The guard sits on every sync write, so a browser without a working
    // getBytesInUse must not turn each settings change into a failure. The
    // browser's own quota rejection stays the backstop.
    const sync = browser.storage.sync as unknown as {
      getBytesInUse?: (keys: string | string[] | null) => Promise<number>
    }
    sync.getBytesInUse = vi.fn(async () => {
      throw new Error("not implemented")
    })

    await expect(
      assertSyncStorageQuota("new-setting", "value")
    ).resolves.toBeUndefined()
    delete sync.getBytesInUse
  })

  it("still enforces the per-item limit without usage reporting", async () => {
    // The item check is pure arithmetic; losing the total check must not lose
    // the one that needs no browser support.
    const sync = browser.storage.sync as unknown as {
      getBytesInUse?: (keys: string | string[] | null) => Promise<number>
    }
    delete sync.getBytesInUse

    await expect(
      assertSyncStorageQuota("large-setting", "x".repeat(9_000))
    ).rejects.toMatchObject({ kind: "item" })
  })
})
