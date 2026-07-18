import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ProviderId, ProviderType } from "@/lib/providers/types"
import { extensionRpcClient } from "@/protocol/extension-client"
import { RpcMethod } from "@/protocol/rpc"
import { useProviderSettingsState } from "../use-provider-settings-state"

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  useProviderHealth: vi.fn(() => ({}))
}))

vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }))
vi.mock("../use-provider-health", () => ({
  useProviderHealth: mocks.useProviderHealth
}))
vi.mock("@/protocol/extension-client", () => ({
  extensionRpcClient: { call: vi.fn() }
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values?.name ? `${key} ${values.name}` : key
  })
}))

const ollama = {
  id: ProviderId.OLLAMA,
  name: "Ollama",
  type: ProviderType.OLLAMA,
  enabled: true,
  baseUrl: "http://localhost:11434",
  hasApiKey: false
}

const custom = {
  id: "custom:openai:test",
  name: "Custom server",
  type: ProviderType.OPENAI,
  enabled: true,
  baseUrl: "https://example.test/v1",
  hasApiKey: false
}

describe("useProviderSettingsState", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("keeps a removed provider out of local state when refresh fails", async () => {
    vi.mocked(extensionRpcClient.call).mockImplementation(async (method) => {
      if (method === RpcMethod.ProvidersList) {
        const listCalls = vi
          .mocked(extensionRpcClient.call)
          .mock.calls.filter(
            ([calledMethod]) => calledMethod === RpcMethod.ProvidersList
          ).length
        if (listCalls > 1) throw new Error("refresh failed")
        return { providers: [ollama, custom] } as never
      }
      if (method === RpcMethod.ProvidersRemove) {
        return { removedProviderId: custom.id } as never
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const { result } = renderHook(() => useProviderSettingsState())

    await waitFor(() => {
      expect(result.current.providers).toHaveLength(2)
    })

    await act(async () => {
      await result.current.removeProvider(custom.id)
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.providers).toEqual([ollama])
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "settings.providers.add.removed_title",
      description: "settings.providers.add.removed_description Custom server"
    })
  })
})
