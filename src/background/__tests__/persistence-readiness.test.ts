import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  ensureMigrated: vi.fn(),
  ensurePersistenceOwnerReady: vi.fn(),
  registerChromiumPersistenceControl: vi.fn(),
  registerPersistenceHost: vi.fn()
}))

vi.mock("@/lib/persistence/chromium-owner", () => ({
  ensurePersistenceOwnerReady: mocks.ensurePersistenceOwnerReady,
  registerChromiumPersistenceControl: mocks.registerChromiumPersistenceControl
}))

vi.mock("@/lib/persistence/owner-host", () => ({
  ensureMigrated: mocks.ensureMigrated,
  registerPersistenceHost: mocks.registerPersistenceHost
}))

const loadTopology = async ({
  firefox = false,
  ownerAvailable = true,
  spike = false
}: {
  firefox?: boolean
  ownerAvailable?: boolean
  spike?: boolean
} = {}) => {
  vi.resetModules()
  vi.stubGlobal("__FIREFOX_BG_OWNER__", firefox)
  vi.stubGlobal("__SPIKE_OPFS_OWNER__", spike)
  vi.stubGlobal("__SPIKE_OPFS_OWNER_MV2__", false)
  chrome.runtime.onMessage = (ownerAvailable
    ? { addListener: vi.fn() }
    : undefined) as unknown as typeof chrome.runtime.onMessage
  return import("../persistence-readiness")
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.ensureMigrated.mockResolvedValue(undefined)
  mocks.ensurePersistenceOwnerReady.mockResolvedValue(undefined)
  document.body.innerHTML = ""
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("startPersistenceTopology", () => {
  it("is a no-op when the runtime has no owner topology", async () => {
    const { startPersistenceTopology } = await loadTopology({
      ownerAvailable: false
    })

    await expect(startPersistenceTopology()).resolves.toBeUndefined()
    expect(mocks.registerChromiumPersistenceControl).not.toHaveBeenCalled()
    expect(mocks.registerPersistenceHost).not.toHaveBeenCalled()
  })

  it("is a no-op in the benchmark build that owns the offscreen slot", async () => {
    const { startPersistenceTopology } = await loadTopology({ spike: true })

    await expect(startPersistenceTopology()).resolves.toBeUndefined()
    expect(mocks.registerChromiumPersistenceControl).not.toHaveBeenCalled()
  })

  it("shares one Chromium startup across concurrent callers", async () => {
    let releaseOwner: (() => void) | undefined
    mocks.ensurePersistenceOwnerReady.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseOwner = resolve
        })
    )
    const { startPersistenceTopology } = await loadTopology()

    const first = startPersistenceTopology()
    const second = startPersistenceTopology()

    expect(first).toBe(second)
    await vi.waitFor(() => {
      expect(mocks.registerChromiumPersistenceControl).toHaveBeenCalledOnce()
      expect(mocks.ensurePersistenceOwnerReady).toHaveBeenCalledOnce()
    })

    releaseOwner?.()
    await expect(first).resolves.toBeUndefined()
  })

  it("clears a failed startup so the next caller can retry", async () => {
    mocks.ensurePersistenceOwnerReady
      .mockRejectedValueOnce(new Error("offscreen creation failed"))
      .mockResolvedValueOnce(undefined)
    const { startPersistenceTopology } = await loadTopology()

    await expect(startPersistenceTopology()).rejects.toThrow(
      "offscreen creation failed"
    )
    await expect(startPersistenceTopology()).resolves.toBeUndefined()

    expect(mocks.registerChromiumPersistenceControl).toHaveBeenCalledTimes(2)
    expect(mocks.ensurePersistenceOwnerReady).toHaveBeenCalledTimes(2)
  })

  it("starts the Firefox in-process owner and installs one ingestion host", async () => {
    const append = vi
      .spyOn(document.body, "append")
      .mockImplementation(() => {})
    const { startPersistenceTopology } = await loadTopology({ firefox: true })

    await startPersistenceTopology()
    await startPersistenceTopology()

    expect(mocks.registerPersistenceHost).toHaveBeenCalledOnce()
    expect(mocks.ensureMigrated).toHaveBeenCalledOnce()
    expect(append).toHaveBeenCalledOnce()
    const frame = append.mock.calls[0]?.[0] as HTMLIFrameElement
    expect(frame.id).toBe("ingestion-processor-host")
    expect(frame.hidden).toBe(true)
    expect(frame.src).toBe(
      "chrome-extension://test/ingestion-processor.html?host=1"
    )
  })
})
