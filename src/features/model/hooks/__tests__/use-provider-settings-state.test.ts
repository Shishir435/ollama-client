import { RpcMethod } from "@ollama-client/contracts/rpc"
import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createAppError } from "@/lib/error-utils"
import { ProviderId, ProviderType } from "@/lib/providers/types"
import { extensionRpcClient } from "@/protocol/extension-client"
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
  hasApiKey: false,
  apiKey: { state: "unchanged" as const }
}

const custom = {
  id: "custom:openai:test",
  name: "Custom server",
  type: ProviderType.OPENAI,
  enabled: true,
  baseUrl: "https://example.test/v1",
  hasApiKey: false,
  apiKey: { state: "unchanged" as const }
}

const getMutationTarget = (request: unknown) =>
  (request as { target?: "existing" | "new" }).target

describe("useProviderSettingsState", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("discards to the successful save while preserving edits made during that save", async () => {
    let finishSave!: (value: any) => void
    vi.mocked(extensionRpcClient.call).mockImplementation(async (method) => {
      if (method === RpcMethod.ProvidersList)
        return { providers: [ollama] } as never
      if (method === RpcMethod.ProvidersUpsert)
        return (await new Promise((resolve) => {
          finishSave = resolve
        })) as never
      throw new Error(`Unexpected method: ${method}`)
    })
    const { result } = renderHook(() => useProviderSettingsState())
    await waitFor(() => expect(result.current.providers).toEqual([ollama]))
    act(() =>
      result.current.updateConfig({ baseUrl: "http://localhost:11435" })
    )
    let saving!: Promise<boolean>
    act(() => {
      saving = result.current.handleSave(result.current.activeConfig!)
    })
    act(() => result.current.updateConfig({ name: "New draft" }))
    await act(async () => {
      finishSave({ provider: { ...ollama, baseUrl: "http://localhost:11435" } })
      await saving
    })
    expect(result.current.activeConfig?.name).toBe("New draft")
    expect(result.current.hasUnsavedChanges).toBe(true)
    act(() => result.current.discardChanges())
    expect(result.current.activeConfig?.baseUrl).toBe("http://localhost:11435")
    expect(result.current.activeConfig?.name).toBe("Ollama")
    expect(result.current.hasUnsavedChanges).toBe(false)
  })

  it("removes a provider without replacing concurrent local edits", async () => {
    vi.mocked(extensionRpcClient.call).mockImplementation(async (method) => {
      if (method === RpcMethod.ProvidersList) {
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

    act(() => {
      result.current.updateConfig({ baseUrl: "http://localhost:11435" })
    })

    let removed = false
    await act(async () => {
      removed = await result.current.removeProvider(custom.id)
    })

    expect(removed).toBe(true)
    expect(result.current.providers).toEqual([
      { ...ollama, baseUrl: "http://localhost:11435" }
    ])
    expect(
      vi
        .mocked(extensionRpcClient.call)
        .mock.calls.filter(
          ([calledMethod]) => calledMethod === RpcMethod.ProvidersList
        )
    ).toHaveLength(1)
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "settings.providers.add.removed_title",
      description: "settings.providers.add.removed_description Custom server"
    })
  })

  it("adds a provider by merging the mutation response, without a list refresh", async () => {
    const added = {
      ...custom,
      id: "custom:openai:added",
      name: "Added server"
    }
    vi.mocked(extensionRpcClient.call).mockImplementation(
      async (method, request) => {
        if (method === RpcMethod.ProvidersList) {
          return { providers: [ollama] } as never
        }
        if (method === RpcMethod.ProvidersUpsert) {
          return getMutationTarget(request) === "existing"
            ? {
                provider: {
                  ...ollama,
                  baseUrl: "http://localhost:11435"
                }
              }
            : ({ provider: added } as never)
        }
        throw new Error(`Unexpected method: ${method}`)
      }
    )

    const { result } = renderHook(() => useProviderSettingsState())

    await waitFor(() => {
      expect(result.current.providers).toEqual([ollama])
    })

    await act(async () => {
      await result.current.addProvider({
        name: added.name,
        baseUrl: added.baseUrl,
        wire: "openai"
      })
    })

    expect(result.current.providers).toEqual([ollama, added])
    const upserts = vi
      .mocked(extensionRpcClient.call)
      .mock.calls.filter(
        ([calledMethod]) => calledMethod === RpcMethod.ProvidersUpsert
      )
    expect(upserts.map(([, request]) => getMutationTarget(request))).toEqual([
      "new"
    ])
    expect(
      vi
        .mocked(extensionRpcClient.call)
        .mock.calls.filter(
          ([calledMethod]) => calledMethod === RpcMethod.ProvidersList
        )
    ).toHaveLength(1)
  })

  it("refuses to add or switch providers while a draft is unsaved, writing nothing", async () => {
    vi.mocked(extensionRpcClient.call).mockImplementation(async (method) => {
      if (method === RpcMethod.ProvidersList) {
        return { providers: [ollama, custom] } as never
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const { result } = renderHook(() => useProviderSettingsState())
    await waitFor(() => expect(result.current.providers).toHaveLength(2))

    act(() => {
      result.current.updateConfig({ baseUrl: "http://localhost:11435" })
    })
    let switched = true
    let added = true
    await act(async () => {
      switched = result.current.setSelectedId(custom.id)
      added = await result.current.addProvider({
        name: "Added",
        baseUrl: "https://added.test/v1",
        wire: "openai"
      })
    })

    expect(switched).toBe(false)
    expect(added).toBe(false)
    expect(result.current.selectedId).toBe(ProviderId.OLLAMA)
    expect(result.current.hasUnsavedChanges).toBe(true)
    expect(
      vi
        .mocked(extensionRpcClient.call)
        .mock.calls.filter(([method]) => method === RpcMethod.ProvidersUpsert)
    ).toHaveLength(0)
  })

  it("discards a draft back to the stored copy and then allows switching", async () => {
    vi.mocked(extensionRpcClient.call).mockImplementation(async (method) => {
      if (method === RpcMethod.ProvidersList) {
        return { providers: [ollama, custom] } as never
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const { result } = renderHook(() => useProviderSettingsState())
    await waitFor(() => expect(result.current.providers).toHaveLength(2))
    act(() => {
      result.current.updateConfig({ baseUrl: "http://localhost:11435" })
    })
    act(() => result.current.discardChanges())

    expect(result.current.activeConfig?.baseUrl).toBe(ollama.baseUrl)
    expect(result.current.hasUnsavedChanges).toBe(false)
    act(() => {
      expect(result.current.setSelectedId(custom.id)).toBe(true)
    })
    expect(result.current.selectedId).toBe(custom.id)
  })

  it("keeps custom model edits as drafts until the explicit save", async () => {
    vi.mocked(extensionRpcClient.call).mockImplementation(
      async (method, request) => {
        if (method === RpcMethod.ProvidersList) {
          return { providers: [ollama, custom] } as never
        }
        if (method === RpcMethod.ProvidersUpsert) {
          const config = (request as { config: typeof custom }).config
          return { provider: { ...config, hasApiKey: false } } as never
        }
        throw new Error(`Unexpected method: ${method}`)
      }
    )

    const { result } = renderHook(() => useProviderSettingsState())
    await waitFor(() => expect(result.current.providers).toHaveLength(2))
    act(() => {
      result.current.setSelectedId(custom.id)
    })
    act(() => {
      result.current.updateConfig({ baseUrl: "https://edited.test/v1" })
      result.current.setCustomModels(["trustedrouter/cheap"])
    })

    expect(extensionRpcClient.call).not.toHaveBeenCalledWith(
      RpcMethod.ProvidersUpsert,
      expect.anything()
    )
    expect(result.current.hasUnsavedChanges).toBe(true)

    const draft = result.current.activeConfig
    if (!draft) throw new Error("Expected an active provider")
    await act(async () => {
      await result.current.handleSave(draft)
    })

    expect(extensionRpcClient.call).toHaveBeenCalledWith(
      RpcMethod.ProvidersUpsert,
      expect.objectContaining({
        config: expect.objectContaining({
          baseUrl: "https://edited.test/v1",
          customModels: ["trustedrouter/cheap"]
        })
      })
    )
    expect(result.current.hasUnsavedChanges).toBe(false)
    expect(result.current.saveStatus).toBe("saved")
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it("treats the enable switch as a draft committed by Save", async () => {
    vi.mocked(extensionRpcClient.call).mockImplementation(
      async (method, request) => {
        if (method === RpcMethod.ProvidersList) {
          return { providers: [ollama] } as never
        }
        if (method === RpcMethod.ProvidersUpsert) {
          const config = (request as { config: typeof ollama }).config
          return { provider: { ...config, hasApiKey: false } } as never
        }
        throw new Error(`Unexpected method: ${method}`)
      }
    )

    const { result } = renderHook(() => useProviderSettingsState())
    await waitFor(() => expect(result.current.providers).toEqual([ollama]))
    act(() => result.current.setProviderEnabled(false))

    expect(result.current.activeConfig?.enabled).toBe(false)
    expect(result.current.hasUnsavedChanges).toBe(true)
    expect(extensionRpcClient.call).not.toHaveBeenCalledWith(
      RpcMethod.ProvidersSetEnabled,
      expect.anything()
    )

    const draft = result.current.activeConfig
    if (!draft) throw new Error("Expected an active provider")
    await act(async () => {
      await result.current.handleSave(draft)
    })
    expect(extensionRpcClient.call).toHaveBeenCalledWith(
      RpcMethod.ProvidersUpsert,
      expect.objectContaining({
        config: expect.objectContaining({ enabled: false })
      })
    )
  })

  it("reports a failed save inline and keeps the draft", async () => {
    vi.mocked(extensionRpcClient.call).mockImplementation(async (method) => {
      if (method === RpcMethod.ProvidersList) {
        return { providers: [ollama] } as never
      }
      throw new Error("save failed")
    })

    const { result } = renderHook(() => useProviderSettingsState())
    await waitFor(() => expect(result.current.providers).toEqual([ollama]))
    act(() => result.current.updateConfig({ name: "Renamed" }))
    const draft = result.current.activeConfig
    if (!draft) throw new Error("Expected an active provider")
    await act(async () => {
      await result.current.handleSave(draft)
    })

    expect(result.current.saveStatus).toBe("failed")
    expect(result.current.hasUnsavedChanges).toBe(true)
  })

  it("sends explicit replace and clear intents for API-key edits", async () => {
    vi.mocked(extensionRpcClient.call).mockImplementation(
      async (method, request) => {
        if (method === RpcMethod.ProvidersList) {
          return { providers: [custom] } as never
        }
        if (method === RpcMethod.ProvidersUpsert) {
          const config = request as { config: { apiKey: { state: string } } }
          return {
            provider: {
              ...custom,
              hasApiKey: config.config.apiKey.state !== "cleared"
            }
          } as never
        }
        throw new Error(`Unexpected method: ${method}`)
      }
    )

    const { result } = renderHook(() => useProviderSettingsState())
    await waitFor(() => expect(result.current.providers).toHaveLength(1))
    await act(async () => result.current.setSelectedId(custom.id))

    act(() => result.current.updateConfig({ apiKey: "replacement" }))
    const replacementDraft = result.current.activeConfig
    if (!replacementDraft) throw new Error("Expected an active provider")
    await act(async () => result.current.handleSave(replacementDraft))
    act(() => result.current.updateConfig({ clearApiKey: true }))
    const clearedDraft = result.current.activeConfig
    if (!clearedDraft) throw new Error("Expected an active provider")
    await act(async () => result.current.handleSave(clearedDraft))

    const configs = vi
      .mocked(extensionRpcClient.call)
      .mock.calls.filter(([method]) => method === RpcMethod.ProvidersUpsert)
      .map(([, request]) => (request as { config: { apiKey: unknown } }).config)
    expect(configs.map(({ apiKey }) => apiKey)).toEqual([
      { state: "replaced", value: "replacement" },
      { state: "cleared" }
    ])
  })

  const testConnectionFor = async (providerId: string) => {
    const hook = renderHook(() => useProviderSettingsState())
    await waitFor(() => expect(hook.result.current.providers).toHaveLength(2))
    await act(async () => {
      await hook.result.current.setSelectedId(providerId)
    })
    await act(async () => {
      await hook.result.current.handleTestConnection()
    })
    return hook
  }

  it("reports an endpoint without a model list as usable when ids are declared", async () => {
    vi.mocked(extensionRpcClient.call).mockImplementation(async (method) => {
      if (method === RpcMethod.ProvidersList) {
        return { providers: [ollama, custom] } as never
      }
      if (method === RpcMethod.ProvidersTestConnection) {
        return {
          providerId: custom.id,
          reachable: true,
          modelCount: 2,
          modelListSupported: false,
          latencyMs: 3
        } as never
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const hook = await testConnectionFor(custom.id)

    expect(hook.result.current.connectionStatus).toEqual({
      success: true,
      message: "settings.providers.test_connection.inline_success_manual"
    })
  })

  it("tells the user to declare model ids when the endpoint lists none", async () => {
    vi.mocked(extensionRpcClient.call).mockImplementation(async (method) => {
      if (method === RpcMethod.ProvidersList) {
        return { providers: [ollama, custom] } as never
      }
      if (method === RpcMethod.ProvidersTestConnection) {
        return {
          providerId: custom.id,
          reachable: true,
          modelCount: 0,
          modelListSupported: false,
          latencyMs: 3
        } as never
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const hook = await testConnectionFor(custom.id)

    expect(hook.result.current.connectionStatus).toEqual({
      success: false,
      message: "settings.providers.test_connection.inline_no_model_list"
    })
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it("heads a catalog-less provider as model IDs only, not connected", async () => {
    // The background check reports a model count for the ids the user
    // declared, without contacting anything. "Connected" reads that count, so
    // it has to stand behind the state that knows where the count came from.
    mocks.useProviderHealth.mockReturnValue({
      [custom.id]: {
        success: true,
        modelListSupported: false,
        lastChecked: 1
      }
    })
    vi.mocked(extensionRpcClient.call).mockImplementation(async (method) => {
      if (method === RpcMethod.ProvidersList) {
        return { providers: [ollama, custom] } as never
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const { result } = renderHook(() => useProviderSettingsState())
    await waitFor(() => expect(result.current.providers).toHaveLength(2))
    await act(async () => {
      await result.current.setSelectedId(custom.id)
    })

    expect(result.current.headerStatus.label).toBe("manual_models")
  })

  it("heads a catalog-less provider as connected once a test reaches it", async () => {
    mocks.useProviderHealth.mockReturnValue({
      [custom.id]: {
        success: true,
        modelListSupported: false,
        lastChecked: 1
      }
    })
    vi.mocked(extensionRpcClient.call).mockImplementation(async (method) => {
      if (method === RpcMethod.ProvidersList) {
        return { providers: [ollama, custom] } as never
      }
      if (method === RpcMethod.ProvidersTestConnection) {
        return {
          providerId: custom.id,
          reachable: true,
          modelCount: 2,
          modelListSupported: false,
          latencyMs: 3
        } as never
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const hook = await testConnectionFor(custom.id)

    // The test streamed a token from the chat endpoint, which the background
    // check never does — that verdict outranks the remembered catalog answer.
    expect(hook.result.current.headerStatus.label).toBe("connected")
  })

  it("shows a classified failure inline only, with the Ollama origins command", async () => {
    vi.mocked(extensionRpcClient.call).mockImplementation(async (method) => {
      if (method === RpcMethod.ProvidersList) {
        return { providers: [ollama, custom] } as never
      }
      if (method === RpcMethod.ProvidersTestConnection) {
        throw createAppError("blocked", {
          kind: "provider",
          status: 403,
          messageKey: "onboarding.provider.errors.cors",
          messageParams: { provider: "Ollama" }
        })
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const hook = await testConnectionFor(ollama.id)

    expect(hook.result.current.connectionStatus).toEqual({
      success: false,
      message: "onboarding.provider.errors.cors"
    })
    expect(hook.result.current.connectionFixCommand).toContain(
      "OLLAMA_ORIGINS="
    )
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it("names a failed save by provider instead of a bare Error", async () => {
    vi.mocked(extensionRpcClient.call).mockImplementation(async (method) => {
      if (method === RpcMethod.ProvidersList) {
        return { providers: [ollama, custom] } as never
      }
      throw new Error(`Unexpected method: ${method}`)
    })
    const hook = renderHook(() => useProviderSettingsState())
    await waitFor(() => expect(hook.result.current.providers).toHaveLength(2))

    await act(async () => {
      await hook.result.current.handleSave(hook.result.current.activeConfig!)
    })

    expect(mocks.toast).toHaveBeenCalledWith({
      variant: "destructive",
      title: "settings.providers.save_failed_title Ollama",
      description: "settings.providers.save_failed_description"
    })
  })
})
