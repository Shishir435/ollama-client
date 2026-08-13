import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  ensureHost: vi.fn()
}))

vi.mock("@/lib/browser-api", () => ({
  browser: { runtime: { sendMessage: mocks.sendMessage } }
}))

vi.mock("@/lib/persistence/client", () => ({
  ensurePersistenceHost: mocks.ensureHost
}))

import {
  INGESTION_PROCESS_REQUEST,
  processStagedIngestion
} from "../ingestion-processor-protocol"

const flush = async (): Promise<void> => {
  for (let i = 0; i < 40; i++) {
    await vi.advanceTimersByTimeAsync(1000)
  }
}

describe("processStagedIngestion", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.ensureHost.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("ensures the host exists before asking it to parse", async () => {
    mocks.sendMessage.mockResolvedValue({ ok: true })

    const done = processStagedIngestion("job-1")
    await flush()
    await expect(done).resolves.toBeUndefined()

    expect(mocks.ensureHost).toHaveBeenCalled()
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: INGESTION_PROCESS_REQUEST,
      jobId: "job-1"
    })
  })

  it("waits out a cold host that has no receiver yet", async () => {
    mocks.sendMessage
      .mockRejectedValueOnce(
        new Error(
          "Could not establish connection. Receiving end does not exist"
        )
      )
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue({ ok: true })

    const done = processStagedIngestion("job-2")
    await flush()

    await expect(done).resolves.toBeUndefined()
    expect(mocks.sendMessage).toHaveBeenCalledTimes(3)
  })

  it("fails fast on a real parsing error", async () => {
    mocks.sendMessage.mockResolvedValue({
      ok: false,
      error: "unsupported file"
    })

    const done = processStagedIngestion("job-3")
    const assertion = expect(done).rejects.toThrow("unsupported file")
    await flush()
    await assertion

    expect(mocks.sendMessage).toHaveBeenCalledOnce()
  })

  it("gives up only after the startup budget is exhausted", async () => {
    mocks.sendMessage.mockResolvedValue(undefined)

    const done = processStagedIngestion("job-4")
    const assertion = expect(done).rejects.toThrow(
      "The durable file processor host is unavailable"
    )
    await flush()
    await assertion

    expect(mocks.sendMessage.mock.calls.length).toBeGreaterThan(5)
  })
})
