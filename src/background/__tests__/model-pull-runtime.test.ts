import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ModelPullRun } from "@/lib/repositories/model-pull-runs"

const mocks = vi.hoisted(() => ({
  runs: new Map<string, ModelPullRun>(),
  consume: vi.fn(),
  getProvider: vi.fn()
}))

vi.mock("@/lib/repositories/model-pull-runs", () => ({
  saveModelPullRun: vi.fn(async (run: ModelPullRun) => {
    mocks.runs.set(run.id, { ...run })
  }),
  getModelPullRun: vi.fn(async (id: string) => mocks.runs.get(id) ?? null),
  listActiveModelPullRuns: vi.fn(async () =>
    [...mocks.runs.values()].filter(
      (run) => run.status === "queued" || run.status === "running"
    )
  ),
  findActiveModelPullRun: vi.fn(
    async (model: string, providerId?: string) =>
      [...mocks.runs.values()].find(
        (run) =>
          run.model === model &&
          run.providerId === providerId &&
          (run.status === "queued" || run.status === "running")
      ) ?? null
  )
}))

vi.mock("@/lib/providers/factory", () => ({
  ProviderFactory: {
    getProviderForModel: mocks.getProvider
  }
}))

vi.mock("@/background/handlers/handle-pull-stream", () => ({
  consumePullStream: mocks.consume
}))

import { ModelPullService } from "../model-pull-runtime"

const activeRun = (): ModelPullRun => ({
  id: "00000000-0000-4000-8000-000000000010",
  model: "llama3",
  providerId: "ollama",
  status: "running",
  statusText: "Downloading",
  progress: 20,
  createdAt: 1,
  updatedAt: 2
})

describe("ModelPullService", () => {
  beforeEach(() => {
    mocks.runs.clear()
    vi.clearAllMocks()
    mocks.getProvider.mockResolvedValue({
      id: "ollama",
      config: { baseUrl: "http://localhost:11434" },
      capabilities: { modelPull: true }
    })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        body: {}
      })
    )
    mocks.consume.mockImplementation(async (_response, options) => {
      await options.onEvent({
        version: 1,
        type: "model_pull_progress",
        status: "Downloading: 50%",
        progress: 50
      })
      await options.onEvent({
        version: 1,
        type: "model_pull_complete",
        status: "success"
      })
    })
  })

  it("persists progress and completion independently of an observer", async () => {
    const submitted = await ModelPullService.submit({
      model: "llama3",
      providerId: "ollama"
    })

    expect(submitted.status).toBe("queued")
    await vi.waitFor(async () => {
      await expect(
        ModelPullService.get(submitted.jobId)
      ).resolves.toMatchObject({
        status: "completed",
        statusText: "success",
        progress: 100
      })
    })
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/pull",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "llama3" })
      })
    )
  })

  it("resumes an incomplete receipt on worker startup", async () => {
    const run = activeRun()
    mocks.runs.set(run.id, run)

    await ModelPullService.resumeIncomplete()

    await expect(ModelPullService.get(run.id)).resolves.toMatchObject({
      status: "completed",
      progress: 100
    })
  })

  it("interrupts startup recovery without recording a user cancellation", async () => {
    const run = activeRun()
    mocks.runs.set(run.id, run)
    vi.mocked(fetch).mockImplementationOnce(
      async (_input, init) =>
        new Promise((_, reject) => {
          const signal = init?.signal
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Stopped", "AbortError")),
            { once: true }
          )
        })
    )
    const controller = new AbortController()

    const recovery = ModelPullService.resumeIncomplete(controller.signal)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    controller.abort()
    await expect(recovery).rejects.toMatchObject({ name: "AbortError" })

    await expect(ModelPullService.get(run.id)).resolves.toMatchObject({
      status: "running"
    })
  })

  it("deduplicates active downloads for the same provider and model", async () => {
    mocks.consume.mockImplementation(
      async (_response, options) =>
        new Promise<void>((resolve) => {
          const waitForCancel = () => {
            if (options.isCancelled()) {
              resolve()
            } else {
              setTimeout(waitForCancel, 0)
            }
          }
          waitForCancel()
        })
    )

    const first = await ModelPullService.submit({
      model: "llama3",
      providerId: "ollama"
    })
    const duplicate = await ModelPullService.submit({
      model: "llama3",
      providerId: "ollama"
    })

    expect(duplicate.jobId).toBe(first.jobId)
    await ModelPullService.cancel(first.jobId)
    await expect(ModelPullService.get(first.jobId)).resolves.toMatchObject({
      status: "cancelled"
    })
  })
})
