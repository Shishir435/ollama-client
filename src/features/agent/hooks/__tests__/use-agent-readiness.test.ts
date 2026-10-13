import { RpcMethod } from "@ollama-client/contracts/rpc"
import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { browser } from "@/lib/browser-api"
import { STORAGE_KEYS } from "@/lib/constants"
import { SETTINGS } from "@/lib/storage/settings"

const call = vi.hoisted(() => vi.fn())
const settings = vi.hoisted(() => ({
  enabled: true as boolean,
  selected: { providerId: "ollama", modelId: "qwen3" } as {
    providerId: string
    modelId: string
  } | null
}))

vi.mock("@/protocol/extension-client", () => ({
  extensionRpcClient: { call }
}))

vi.mock("@/hooks/use-setting", () => ({
  useSetting: (descriptor: { key: string }) => [
    descriptor.key === SETTINGS.AGENT_ENABLED.key
      ? settings.enabled
      : settings.selected,
    vi.fn(),
    { isLoading: false }
  ]
}))

import { useAgentReadiness } from "../use-agent-readiness"

const flush = () => act(async () => undefined)
const ready = { status: "ready", reason: "metadata", vision: "unknown" }

beforeEach(() => {
  call.mockReset()
  settings.enabled = true
  settings.selected = { providerId: "ollama", modelId: "qwen3" }
})

describe("useAgentReadiness", () => {
  it("asks for the selected model's readiness", async () => {
    call.mockResolvedValue({ readiness: ready, qualified: false })
    const { result } = renderHook(() => useAgentReadiness())
    await flush()
    expect(call).toHaveBeenCalledWith(RpcMethod.AgentGetReadiness, {
      providerId: "ollama",
      modelId: "qwen3"
    })
    expect(result.current).toEqual({
      kind: "known",
      readiness: ready,
      qualified: false
    })
  })

  it("asks again when the model changes", async () => {
    call.mockResolvedValue({ readiness: ready, qualified: false })
    const { rerender } = renderHook(() => useAgentReadiness())
    await flush()
    settings.selected = { providerId: "ollama", modelId: "llama3.1" }
    rerender()
    await flush()
    expect(call).toHaveBeenLastCalledWith(RpcMethod.AgentGetReadiness, {
      providerId: "ollama",
      modelId: "llama3.1"
    })
  })

  it("asks nothing while the agent is off or no model is selected", async () => {
    settings.enabled = false
    const off = renderHook(() => useAgentReadiness())
    await flush()
    expect(off.result.current).toEqual({ kind: "hidden" })
    settings.enabled = true
    settings.selected = null
    const none = renderHook(() => useAgentReadiness())
    await flush()
    expect(none.result.current).toEqual({ kind: "hidden" })
    expect(call).not.toHaveBeenCalled()
  })

  it("shows nothing when the read fails or names no readiness", async () => {
    call.mockRejectedValueOnce(new Error("timeout"))
    const failed = renderHook(() => useAgentReadiness())
    await flush()
    expect(failed.result.current).toEqual({ kind: "hidden" })
    call.mockResolvedValueOnce({ qualified: false })
    const absent = renderHook(() => useAgentReadiness())
    await flush()
    expect(absent.result.current).toEqual({ kind: "hidden" })
  })

  it("asks again when the evidence behind the verdict changes", async () => {
    vi.useFakeTimers()
    try {
      call.mockResolvedValue({ readiness: ready, qualified: false })
      const addListener = vi.mocked(browser.storage.onChanged.addListener)
      addListener.mockClear()
      renderHook(() => useAgentReadiness())
      await flush()
      expect(call).toHaveBeenCalledTimes(1)
      const onChanged = addListener.mock.calls.at(-1)?.[0] as unknown as (
        changes: Record<string, unknown>
      ) => void

      onChanged({ unrelated: {} })
      await act(async () => vi.advanceTimersByTime(500))
      expect(call).toHaveBeenCalledTimes(1)

      onChanged({ [STORAGE_KEYS.PROVIDER.MODEL_CAPABILITY_OVERRIDES]: {} })
      await act(async () => vi.advanceTimersByTime(500))
      expect(call).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
