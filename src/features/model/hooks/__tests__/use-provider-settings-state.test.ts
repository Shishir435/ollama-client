import { RpcMethod } from "@ollama-client/contracts/rpc"
import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
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

  it("adds a provider without replacing concurrent local edits", async () => {
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

    act(() => {
      result.current.updateConfig({ baseUrl: "http://localhost:11435" })
    })
    await act(async () => {
      await result.current.addProvider({
        name: added.name,
        baseUrl: added.baseUrl,
        wire: "openai"
      })
    })

    expect(result.current.providers).toEqual([
      { ...ollama, baseUrl: "http://localhost:11435" },
      added
    ])
    const upserts = vi
      .mocked(extensionRpcClient.call)
      .mock.calls.filter(
        ([calledMethod]) => calledMethod === RpcMethod.ProvidersUpsert
      )
    expect(upserts.map(([, request]) => getMutationTarget(request))).toEqual([
      "existing",
      "new"
    ])
    expect(upserts[0]?.[1]).toMatchObject({
      target: "existing",
      config: { id: ProviderId.OLLAMA, baseUrl: "http://localhost:11435" }
    })
    expect(
      vi
        .mocked(extensionRpcClient.call)
        .mock.calls.filter(
          ([calledMethod]) => calledMethod === RpcMethod.ProvidersList
        )
    ).toHaveLength(1)
  })

  it("does not add or switch providers when the pending edit cannot save", async () => {
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
        if (
          method === RpcMethod.ProvidersUpsert &&
          getMutationTarget(request) === "existing"
        ) {
          throw new Error("save failed")
        }
        if (method === RpcMethod.ProvidersUpsert) {
          return { provider: added } as never
        }
        throw new Error(`Unexpected method: ${method}`)
      }
    )

    const { result } = renderHook(() => useProviderSettingsState())
    await waitFor(() => expect(result.current.providers).toEqual([ollama]))

    act(() => {
      result.current.updateConfig({ baseUrl: "http://localhost:11435" })
    })
    let didAdd = true
    await act(async () => {
      didAdd = await result.current.addProvider({
        name: added.name,
        baseUrl: added.baseUrl,
        wire: "openai"
      })
    })

    expect(didAdd).toBe(false)
    expect(result.current.selectedId).toBe(ProviderId.OLLAMA)
    expect(result.current.hasUnsavedChanges).toBe(true)
    expect(result.current.providers).toEqual([
      { ...ollama, baseUrl: "http://localhost:11435" }
    ])
    expect(
      vi
        .mocked(extensionRpcClient.call)
        .mock.calls.filter(
          ([method, request]) =>
            method === RpcMethod.ProvidersUpsert &&
            getMutationTarget(request) === "new"
        )
    ).toHaveLength(0)
  })

  it("keeps edits made while the pre-switch save is pending", async () => {
    const added = {
      ...custom,
      id: "custom:openai:added",
      name: "Added server"
    }
    let resolveSave: ((value: { provider: typeof ollama }) => void) | undefined
    const pendingSave = new Promise<{ provider: typeof ollama }>((resolve) => {
      resolveSave = resolve
    })
    vi.mocked(extensionRpcClient.call).mockImplementation(
      async (method, request) => {
        if (method === RpcMethod.ProvidersList) {
          return { providers: [ollama] } as never
        }
        if (
          method === RpcMethod.ProvidersUpsert &&
          getMutationTarget(request) === "existing"
        ) {
          return (await pendingSave) as never
        }
        if (method === RpcMethod.ProvidersUpsert) {
          return { provider: added } as never
        }
        throw new Error(`Unexpected method: ${method}`)
      }
    )

    const { result } = renderHook(() => useProviderSettingsState())
    await waitFor(() => expect(result.current.providers).toEqual([ollama]))

    act(() => {
      result.current.updateConfig({ baseUrl: "http://localhost:11435" })
    })
    let didAdd = true
    let addPromise: Promise<boolean>
    act(() => {
      addPromise = result.current.addProvider({
        name: added.name,
        baseUrl: added.baseUrl,
        wire: "openai"
      })
    })
    await waitFor(() =>
      expect(
        vi
          .mocked(extensionRpcClient.call)
          .mock.calls.some(
            ([method, request]) =>
              method === RpcMethod.ProvidersUpsert &&
              getMutationTarget(request) === "existing"
          )
      ).toBe(true)
    )

    act(() => {
      result.current.updateConfig({ name: "Edited while saving" })
    })
    await act(async () => {
      resolveSave?.({
        provider: { ...ollama, baseUrl: "http://localhost:11435" }
      })
      didAdd = await addPromise
    })

    expect(didAdd).toBe(false)
    expect(result.current.selectedId).toBe(ProviderId.OLLAMA)
    expect(result.current.hasUnsavedChanges).toBe(true)
    expect(result.current.providers).toEqual([
      {
        ...ollama,
        name: "Edited while saving",
        baseUrl: "http://localhost:11435"
      }
    ])
    expect(
      vi
        .mocked(extensionRpcClient.call)
        .mock.calls.filter(
          ([method, request]) =>
            method === RpcMethod.ProvidersUpsert &&
            getMutationTarget(request) === "new"
        )
    ).toHaveLength(0)
  })

  it("persists manual model ids immediately for the model menu", async () => {
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
    await act(async () => {
      await result.current.setSelectedId(custom.id)
    })
    await act(async () => {
      await result.current.setCustomModels(["trustedrouter/cheap"])
    })

    expect(extensionRpcClient.call).toHaveBeenCalledWith(
      RpcMethod.ProvidersUpsert,
      expect.objectContaining({
        target: "existing",
        config: expect.objectContaining({
          id: custom.id,
          customModels: ["trustedrouter/cheap"]
        })
      })
    )
    expect(result.current.activeConfig?.customModels).toEqual([
      "trustedrouter/cheap"
    ])
    expect(result.current.hasUnsavedChanges).toBe(false)
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
    act(() => result.current.updateConfig({ apiKey: "" }))
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

  it("flushes pending edits before enabling another provider", async () => {
    const disabledCustom = { ...custom, enabled: false }
    const calls: RpcMethod[] = []
    vi.mocked(extensionRpcClient.call).mockImplementation(
      async (method, request) => {
        calls.push(method)
        if (method === RpcMethod.ProvidersList) {
          return { providers: [ollama, disabledCustom] } as never
        }
        if (method === RpcMethod.ProvidersUpsert) {
          const config = (request as { config: typeof disabledCustom }).config
          return { provider: { ...config, hasApiKey: false } } as never
        }
        if (method === RpcMethod.ProvidersSetEnabled) {
          return {
            provider: {
              ...disabledCustom,
              customModels: ["trustedrouter/cheap"],
              enabled: true
            }
          } as never
        }
        throw new Error(`Unexpected method: ${method}`)
      }
    )

    const { result } = renderHook(() => useProviderSettingsState())
    await waitFor(() => expect(result.current.providers).toHaveLength(2))
    await act(async () => {
      await result.current.setSelectedId(disabledCustom.id)
    })
    act(() => {
      result.current.updateConfig({
        customModels: ["trustedrouter/cheap"]
      })
    })
    await act(async () => {
      await result.current.setProviderEnabled(true)
    })

    expect(calls).toEqual([
      RpcMethod.ProvidersList,
      RpcMethod.ProvidersUpsert,
      RpcMethod.ProvidersSetEnabled
    ])
    expect(result.current.providers).toEqual([
      ollama,
      {
        ...disabledCustom,
        customModels: ["trustedrouter/cheap"],
        enabled: true
      }
    ])
  })

  it("keeps edits made while an enable toggle is pending", async () => {
    let resolveToggle:
      | ((value: { provider: typeof ollama }) => void)
      | undefined
    const pendingToggle = new Promise<{ provider: typeof ollama }>(
      (resolve) => {
        resolveToggle = resolve
      }
    )
    vi.mocked(extensionRpcClient.call).mockImplementation(async (method) => {
      if (method === RpcMethod.ProvidersList) {
        return { providers: [ollama] } as never
      }
      if (method === RpcMethod.ProvidersSetEnabled) {
        return (await pendingToggle) as never
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const { result } = renderHook(() => useProviderSettingsState())
    await waitFor(() => expect(result.current.providers).toEqual([ollama]))

    let togglePromise: Promise<void>
    act(() => {
      togglePromise = result.current.setProviderEnabled(false)
    })
    await waitFor(() =>
      expect(extensionRpcClient.call).toHaveBeenCalledWith(
        RpcMethod.ProvidersSetEnabled,
        { providerId: ProviderId.OLLAMA, enabled: false }
      )
    )
    act(() => {
      result.current.updateConfig({ name: "Edited while toggling" })
    })
    await act(async () => {
      resolveToggle?.({ provider: { ...ollama, enabled: false } })
      await togglePromise
    })

    expect(result.current.providers).toEqual([
      { ...ollama, name: "Edited while toggling", enabled: false }
    ])
    expect(result.current.hasUnsavedChanges).toBe(true)
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
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "settings.providers.test_connection.no_model_list_title",
        variant: "destructive"
      })
    )
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
})
