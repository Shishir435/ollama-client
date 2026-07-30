import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { extensionRpcClient } from "@/protocol/extension-client"
import { RpcMethod } from "@/protocol/rpc"
import { useModelPull } from "../use-model-pull"

vi.mock("@/protocol/extension-client", () => ({
  extensionRpcClient: {
    call: vi.fn()
  }
}))

const job = {
  jobId: "00000000-0000-4000-8000-000000000001",
  model: "llama2",
  status: "running" as const,
  statusText: "Starting..."
}

describe("useModelPull", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(extensionRpcClient.call).mockImplementation((method) => {
      if (method === RpcMethod.ModelPullListActive) {
        return Promise.resolve([]) as never
      }
      return new Promise(() => {}) as never
    })
  })

  it("initializes with null state and checks for active jobs", async () => {
    const { result } = renderHook(() => useModelPull())

    expect(result.current.pullingModel).toBeNull()
    expect(result.current.progress).toBeNull()
    await waitFor(() => {
      expect(extensionRpcClient.call).toHaveBeenCalledWith(
        RpcMethod.ModelPullListActive,
        {}
      )
    })
  })

  it("submits a durable model-pull job", () => {
    const { result } = renderHook(() => useModelPull())

    act(() => {
      result.current.pullModel("llama2", "ollama")
    })

    expect(result.current.pullingModel).toBe("llama2")
    expect(result.current.progress).toBe("Starting...")
    expect(extensionRpcClient.call).toHaveBeenCalledWith(
      RpcMethod.ModelPullSubmit,
      {
        model: "llama2",
        providerId: "ollama"
      }
    )
  })

  it("shows persisted progress and completion", async () => {
    vi.mocked(extensionRpcClient.call).mockImplementation((method) => {
      if (method === RpcMethod.ModelPullListActive) {
        return Promise.resolve([]) as never
      }
      if (method === RpcMethod.ModelPullSubmit) {
        return Promise.resolve({
          ...job,
          statusText: "Downloading: 40%",
          progress: 40
        }) as never
      }
      return Promise.resolve({
        ...job,
        status: "completed",
        statusText: "success",
        progress: 100
      }) as never
    })

    const { result } = renderHook(() => useModelPull())
    act(() => {
      result.current.pullModel("llama2")
    })

    await waitFor(() => {
      expect(result.current.progress).toBe("Downloading: 40%")
    })
    await waitFor(
      () => {
        expect(result.current.progress).toBe("✅ Success")
        expect(result.current.pullingModel).toBeNull()
      },
      { timeout: 1000 }
    )
  })

  it("shows provider guidance for a persisted failure", async () => {
    vi.mocked(extensionRpcClient.call).mockImplementation((method) => {
      if (method === RpcMethod.ModelPullListActive) {
        return Promise.resolve([]) as never
      }
      return Promise.resolve({
        ...job,
        status: "failed",
        statusText: "Pull failed",
        failure: {
          status: 500,
          kind: "provider",
          message: "Pull failed",
          retryable: true
        }
      }) as never
    })

    const { result } = renderHook(() => useModelPull())
    act(() => {
      result.current.pullModel("llama2")
    })

    await waitFor(() => {
      expect(result.current.progress).toBe(
        "❌ Failed: Pull failed. Check the selected provider, model, and provider logs. This may be temporary; try again."
      )
      expect(result.current.pullingModel).toBeNull()
    })
  })

  it("reattaches to an active job on mount", async () => {
    vi.mocked(extensionRpcClient.call).mockImplementation((method) => {
      if (method === RpcMethod.ModelPullListActive) {
        return Promise.resolve([job]) as never
      }
      return new Promise(() => {}) as never
    })

    const { result } = renderHook(() => useModelPull())

    await waitFor(() => {
      expect(result.current.pullingModel).toBe("llama2")
      expect(result.current.progress).toBe("Starting...")
    })
  })

  it("cancels the durable job by id", async () => {
    vi.mocked(extensionRpcClient.call).mockImplementation((method) => {
      if (method === RpcMethod.ModelPullListActive) {
        return Promise.resolve([]) as never
      }
      if (method === RpcMethod.ModelPullSubmit) {
        return Promise.resolve(job) as never
      }
      if (method === RpcMethod.ModelPullCancel) {
        return Promise.resolve({
          ...job,
          status: "cancelled",
          statusText: "Cancelled"
        }) as never
      }
      return new Promise(() => {}) as never
    })

    const { result } = renderHook(() => useModelPull())
    act(() => {
      result.current.pullModel("llama2")
    })
    await waitFor(() => {
      expect(result.current.pullingModel).toBe("llama2")
    })

    act(() => {
      result.current.cancelPull()
    })

    expect(result.current.progress).toBe("❌ Cancelled")
    expect(result.current.pullingModel).toBeNull()
    expect(extensionRpcClient.call).toHaveBeenCalledWith(
      RpcMethod.ModelPullCancel,
      { jobId: job.jobId }
    )
  })
})
