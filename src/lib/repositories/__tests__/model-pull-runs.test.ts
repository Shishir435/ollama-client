import { beforeEach, describe, expect, it, vi } from "vitest"

const { query, run, flushSave } = vi.hoisted(() => ({
  query: vi.fn(),
  run: vi.fn(),
  flushSave: vi.fn()
}))

vi.mock("@/lib/sqlite/db", () => ({ query, run, flushSave }))

import { getModelPullRun, saveModelPullRun } from "../model-pull-runs"

beforeEach(() => {
  vi.resetAllMocks()
})

describe("model-pull-runs repository", () => {
  it("force-flushes lifecycle receipts but permits debounced progress", async () => {
    const value = {
      id: "pull-1",
      model: "llama3",
      providerId: "ollama",
      status: "running" as const,
      statusText: "Downloading: 20%",
      progress: 20,
      createdAt: 10,
      updatedAt: 11
    }

    await saveModelPullRun(value)
    expect(run).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO model_pull_runs"),
      [
        "pull-1",
        "llama3",
        "ollama",
        "running",
        "Downloading: 20%",
        20,
        null,
        10,
        11
      ]
    )
    expect(flushSave).toHaveBeenCalledOnce()

    flushSave.mockClear()
    await saveModelPullRun(value, { flush: false })
    expect(flushSave).not.toHaveBeenCalled()
  })

  it("parses structured failures and nullable progress fields", async () => {
    query.mockResolvedValueOnce([
      {
        id: "pull-1",
        model: "llama3",
        providerId: null,
        status: "failed",
        statusText: null,
        progress: null,
        failure: JSON.stringify({
          status: 503,
          message: "Provider unavailable",
          kind: "provider"
        }),
        createdAt: 10,
        updatedAt: 12
      }
    ])

    await expect(getModelPullRun("pull-1")).resolves.toEqual({
      id: "pull-1",
      model: "llama3",
      providerId: undefined,
      status: "failed",
      statusText: undefined,
      progress: undefined,
      failure: {
        status: 503,
        message: "Provider unavailable",
        kind: "provider"
      },
      createdAt: 10,
      updatedAt: 12
    })
  })
})
