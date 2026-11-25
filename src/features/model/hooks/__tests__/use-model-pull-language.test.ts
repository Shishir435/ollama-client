import { RpcMethod } from "@ollama-client/contracts/rpc"
import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { extensionRpcClient } from "@/protocol/extension-client"
import { useModelPull } from "../use-model-pull"

const i18n = vi.hoisted(() => ({ t: (key: string) => key }))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: i18n.t })
}))
vi.mock("@/protocol/extension-client", () => ({
  extensionRpcClient: { call: vi.fn() }
}))

const job = {
  jobId: "00000000-0000-4000-8000-000000000001",
  model: "llama3.2",
  status: "running" as const,
  statusText: "pulling",
  progress: 10
}

describe("useModelPull across a language switch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    i18n.t = (key: string) => key
  })

  it("keeps watching the pull it reattached to instead of reconnecting", async () => {
    vi.mocked(extensionRpcClient.call).mockImplementation((method) => {
      if (method === RpcMethod.ModelPullListActive) {
        return Promise.resolve([job]) as never
      }
      return Promise.resolve(job) as never
    })
    const { result, rerender } = renderHook(() => useModelPull())
    await waitFor(() => expect(result.current.pullingModel).toBe("llama3.2"))

    i18n.t = (key: string) => `de:${key}`
    rerender()

    await waitFor(() =>
      expect(extensionRpcClient.call).toHaveBeenCalledWith(
        RpcMethod.ModelPullGet,
        { jobId: job.jobId }
      )
    )
    expect(
      vi
        .mocked(extensionRpcClient.call)
        .mock.calls.filter(
          ([method]) => method === RpcMethod.ModelPullListActive
        )
    ).toHaveLength(1)
    expect(result.current.pullingModel).toBe("llama3.2")
  })
})
