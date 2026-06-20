import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  create: vi.fn()
}))

vi.mock("@/lib/permissions", () => ({ hasPermission: mocks.hasPermission }))
vi.mock("@/lib/browser-api", () => ({
  browser: {
    notifications: { create: (...a: unknown[]) => mocks.create(...a) },
    runtime: { getURL: (p: string) => `chrome-extension://test/${p}` }
  }
}))
vi.mock("@/lib/logger", () => ({ logger: { debug: vi.fn() } }))

import { notifyJobComplete } from "@/background/lib/notify"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.create.mockResolvedValue("id")
})

describe("notifyJobComplete", () => {
  it("creates a notification when the permission is granted", async () => {
    mocks.hasPermission.mockResolvedValue(true)
    await expect(
      notifyJobComplete({ id: "job-x", title: "Done", message: "Finished" })
    ).resolves.toEqual({ sent: true })
    expect(mocks.create).toHaveBeenCalledWith(
      "job-x",
      expect.objectContaining({
        type: "basic",
        title: "Done",
        message: "Finished"
      })
    )
  })

  it("is a no-op when the permission is not granted", async () => {
    mocks.hasPermission.mockResolvedValue(false)
    await expect(
      notifyJobComplete({ title: "Done", message: "Finished" })
    ).resolves.toEqual({
      sent: false,
      reason: "permission-not-granted"
    })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("never throws if the notifications API rejects", async () => {
    mocks.hasPermission.mockResolvedValue(true)
    mocks.create.mockRejectedValue(new Error("boom"))
    await expect(
      notifyJobComplete({ title: "Done", message: "Finished" })
    ).resolves.toEqual({
      sent: false,
      reason: "create-failed",
      error: "boom"
    })
  })
})
