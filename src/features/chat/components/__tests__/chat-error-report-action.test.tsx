import { RpcMethod } from "@ollama-client/contracts/rpc"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ChatErrorReportAction } from "@/features/chat/components/chat-error-report-action"
import { openExternalUrl, openOptionsInTab } from "@/lib/browser-api"
import { extensionRpcClient } from "@/protocol/extension-client"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock("@/lib/browser-api", () => ({
  openExternalUrl: vi.fn(),
  openOptionsInTab: vi.fn(),
  runtime: {
    getManifest: () => ({ version: "0.12.4" }),
    getURL: (path: string) => `chrome-extension://test/${path}`
  }
}))

vi.mock("@/protocol/extension-client", () => ({
  extensionRpcClient: { call: vi.fn() }
}))

describe("ChatErrorReportAction", () => {
  it("collects safe diagnostics only when asked, and includes incident data", async () => {
    ;(extensionRpcClient.call as any).mockImplementation(
      async (method: RpcMethod) => {
        if (method === RpcMethod.ProvidersListModels) {
          return {
            models: [{ name: "/Users/alice/Models/qwen.gguf" }],
            failures: []
          }
        }
        if (method === RpcMethod.ProvidersTestConnection) {
          return {
            providerId: "ollama",
            reachable: true,
            modelCount: 1,
            modelListSupported: true,
            latencyMs: 4
          }
        }
        return {
          bundle: {
            format: "ollama-client-support-v1",
            createdAt: 1,
            appVersion: "0.12.4",
            browserFamily: "chromium",
            osFamily: "macos",
            capabilities: {},
            permissions: {},
            providers: [{ profile: "ollama", wire: "ollama", enabled: true }],
            storage: { backend: "sqlite", messageCount: 2, vectorCount: 0 },
            selfTests: [
              { id: "provider_models", status: "pass", durationMs: 3 }
            ],
            events: [
              {
                id: "00000000-0000-4000-8000-000000000000",
                at: 1,
                level: "error",
                code: "REQUEST_FAILED",
                operation: "streaming-chat",
                surface: "background",
                sessionId: "session-123",
                status: 500,
                supportCode: "INC-ABC12345"
              }
            ]
          }
        } as never
      }
    )

    render(
      <ChatErrorReportAction
        sessionId="session-123"
        msg={{
          role: "assistant",
          content: "Ollama failed",
          error: {
            kind: "provider",
            status: 500,
            code: "OLC-OUT-OF-MEMORY",
            phase: "response",
            incidentId: "INC-ABC12345",
            recoveryAction: "choose-model",
            providerId: "ollama",
            model: "/Users/alice/Models/qwen.gguf"
          }
        }}
      />
    )

    // The bundle runs the whole diagnostic suite, so mounting a failed message
    // must not start it.
    expect(extensionRpcClient.call).not.toHaveBeenCalled()

    fireEvent.click(
      screen.getByRole("button", { name: "chat.errors.open_issue" })
    )

    await waitFor(() =>
      expect(extensionRpcClient.call).toHaveBeenCalledWith(
        RpcMethod.DiagnosticsGetBundle,
        { sessionId: "session-123" }
      )
    )

    await waitFor(() => expect(openExternalUrl).toHaveBeenCalledOnce())
    const reportUrl = new URL(vi.mocked(openExternalUrl).mock.calls[0][0])
    const body = reportUrl.searchParams.get("body") || ""
    expect(body).toContain("- Error code: OLC-OUT-OF-MEMORY")
    expect(body).toContain("- Incident ID: INC-ABC12345")
    expect(body).toContain("/Users/<redacted>/Models/qwen.gguf")
    expect(body).toContain("provider_models=pass")
    expect(body).toContain("- Provider reachable: yes")
    expect(body).toContain("- Selected model discovered: yes")
    expect(body).not.toContain("/Users/alice")
  })

  it("copies the automatic diagnostic report from the error bubble", async () => {
    ;(extensionRpcClient.call as any).mockResolvedValue({
      bundle: {
        format: "ollama-client-support-v1",
        createdAt: 1,
        appVersion: "0.12.4",
        browserFamily: "chromium",
        osFamily: "macos",
        capabilities: {},
        permissions: {},
        providers: [],
        storage: { backend: "sqlite", messageCount: 0, vectorCount: 0 },
        selfTests: [],
        events: [
          {
            id: "00000000-0000-4000-8000-000000000000",
            at: 1,
            level: "error",
            code: "PROVIDER_DISABLED",
            operation: "streaming-chat",
            surface: "background",
            sessionId: "session-123",
            supportCode: "INC-ABC12345"
          }
        ]
      }
    })
    // The bundle is claimed inside the click as a promise, so a collection
    // still in flight cannot outlive the click's transient activation.
    const write = vi
      .spyOn(navigator.clipboard, "write")
      .mockResolvedValue(undefined)

    render(
      <ChatErrorReportAction
        sessionId="session-123"
        msg={{
          role: "assistant",
          content: "Ollama failed",
          error: {
            code: "OLC-PROVIDER-HTTP",
            incidentId: "INC-ABC12345",
            providerName: "Ollama"
          }
        }}
      />
    )

    const copyButton = await screen.findByRole("button", {
      name: "chat.errors.copy_diagnostics"
    })
    await waitFor(() => expect(copyButton).toBeEnabled())
    fireEvent.click(copyButton)

    await waitFor(() => expect(write).toHaveBeenCalledOnce())
    const item = write.mock.calls[0][0][0]
    const copied = await (await item.getType("text/plain")).text()
    const copiedBundle = JSON.parse(copied)
    expect(copiedBundle.format).toBe("ollama-client-support-v1")
    expect(copiedBundle.events).toEqual([
      expect.objectContaining({
        code: "PROVIDER_DISABLED",
        supportCode: "INC-ABC12345"
      })
    ])
    expect(copied).not.toContain("**What happened**")
  })

  it("falls back to writeText when the engine refuses a promised item", async () => {
    ;(extensionRpcClient.call as any).mockResolvedValue({
      bundle: {
        format: "ollama-client-support-v1",
        createdAt: 1,
        appVersion: "0.12.4",
        browserFamily: "gecko",
        osFamily: "linux",
        capabilities: {},
        permissions: {},
        providers: [],
        storage: { backend: "sqlite", messageCount: 0, vectorCount: 0 },
        selfTests: [],
        events: []
      }
    })
    // ClipboardItem exists, so the feature check passes — and the write still
    // rejects, which is the case detection cannot see.
    vi.spyOn(navigator.clipboard, "write").mockRejectedValue(
      new Error("promise data unsupported")
    )
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined)

    render(
      <ChatErrorReportAction
        sessionId="session-123"
        msg={{ role: "assistant", content: "failed", error: {} }}
      />
    )

    fireEvent.click(
      screen.getByRole("button", { name: "chat.errors.copy_diagnostics" })
    )

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    expect(JSON.parse(writeText.mock.calls[0][0]).format).toBe(
      "ollama-client-support-v1"
    )
  })

  it("falls back to writeText where ClipboardItem does not exist", async () => {
    ;(extensionRpcClient.call as any).mockResolvedValue({
      bundle: {
        format: "ollama-client-support-v1",
        createdAt: 1,
        appVersion: "0.12.4",
        browserFamily: "gecko",
        osFamily: "linux",
        capabilities: {},
        permissions: {},
        providers: [],
        storage: { backend: "sqlite", messageCount: 0, vectorCount: 0 },
        selfTests: [],
        events: []
      }
    })
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined)
    const clipboardItem = globalThis.ClipboardItem
    // @ts-expect-error deleting a DOM global to model an engine without it
    delete globalThis.ClipboardItem

    try {
      render(
        <ChatErrorReportAction
          sessionId="session-123"
          msg={{ role: "assistant", content: "failed", error: {} }}
        />
      )

      fireEvent.click(
        screen.getByRole("button", { name: "chat.errors.copy_diagnostics" })
      )

      await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
      expect(JSON.parse(writeText.mock.calls[0][0]).format).toBe(
        "ollama-client-support-v1"
      )
    } finally {
      globalThis.ClipboardItem = clipboardItem
    }
  })

  it("enables a disabled provider in place and re-runs the turn", async () => {
    ;(extensionRpcClient.call as any).mockImplementation(
      async (method: RpcMethod) => {
        if (method === RpcMethod.ProvidersSetEnabled) {
          return { provider: { id: "ollama", enabled: true } }
        }
        return { bundle: undefined }
      }
    )
    const onRetry = vi.fn()

    render(
      <ChatErrorReportAction
        sessionId="session-123"
        onRetry={onRetry}
        msg={{
          role: "assistant",
          content: "Provider disabled",
          error: {
            code: "OLC-PROVIDER-DISABLED",
            recoveryAction: "enable-provider",
            providerId: "ollama",
            providerName: "Ollama"
          }
        }}
      />
    )

    fireEvent.click(
      screen.getByRole("button", { name: "chat.errors.enable_provider" })
    )

    await waitFor(() =>
      expect(extensionRpcClient.call).toHaveBeenCalledWith(
        RpcMethod.ProvidersSetEnabled,
        { providerId: "ollama", enabled: true }
      )
    )
    await waitFor(() => expect(onRetry).toHaveBeenCalledOnce())
    // The in-place fix replaces the settings deep link, not adds to it.
    expect(
      screen.queryByRole("button", { name: "settings.shortcuts.open_settings" })
    ).not.toBeInTheDocument()
  })

  it("keeps the turn untouched when the in-place fix fails", async () => {
    ;(extensionRpcClient.call as any).mockImplementation(
      async (method: RpcMethod) => {
        if (method === RpcMethod.ProvidersSetEnabled) {
          throw new Error("forbidden")
        }
        return { bundle: undefined }
      }
    )
    const onRetry = vi.fn()

    render(
      <ChatErrorReportAction
        onRetry={onRetry}
        msg={{
          role: "assistant",
          content: "Provider disabled",
          error: {
            code: "OLC-PROVIDER-DISABLED",
            recoveryAction: "enable-provider",
            providerId: "ollama",
            providerName: "Ollama"
          }
        }}
      />
    )

    fireEvent.click(
      screen.getByRole("button", { name: "chat.errors.enable_provider" })
    )

    await waitFor(() =>
      expect(extensionRpcClient.call).toHaveBeenCalledWith(
        RpcMethod.ProvidersSetEnabled,
        { providerId: "ollama", enabled: true }
      )
    )
    expect(onRetry).not.toHaveBeenCalled()
  })

  it("holds Retry back for the provider's requested wait", async () => {
    ;(extensionRpcClient.call as any).mockResolvedValue({ bundle: undefined })
    const onRetry = vi.fn()

    render(
      <ChatErrorReportAction
        onRetry={onRetry}
        msg={{
          role: "assistant",
          content: "Rate limited",
          timestamp: Date.now(),
          error: {
            code: "OLC-RATE-LIMITED",
            status: 429,
            recoveryAction: "wait-retry",
            retryAfterMs: 30_000
          }
        }}
      />
    )

    const chip = screen.getByRole("button", { name: /chat.errors.retry_in/ })
    expect(chip).toBeDisabled()
    fireEvent.click(chip)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it("offers Retry immediately when no wait was requested", () => {
    ;(extensionRpcClient.call as any).mockResolvedValue({ bundle: undefined })
    const onRetry = vi.fn()

    render(
      <ChatErrorReportAction
        onRetry={onRetry}
        msg={{
          role: "assistant",
          content: "Stream dropped",
          timestamp: Date.now(),
          error: { code: "OLC-STREAM-DROPPED", recoveryAction: "retry" }
        }}
      />
    )

    fireEvent.click(
      screen.getByRole("button", { name: "common.actions.retry" })
    )
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it("warns instead of failing silently when the clipboard is refused", async () => {
    ;(extensionRpcClient.call as any).mockResolvedValue({
      bundle: { format: "ollama-client-support-v1", events: [] }
    })
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("Document is not focused")
    )

    render(
      <ChatErrorReportAction
        msg={{
          role: "assistant",
          content: "Provider failed",
          error: { code: "OLC-PROVIDER-HTTP" }
        }}
      />
    )

    const copyButton = await screen.findByRole("button", {
      name: "chat.errors.copy_diagnostics"
    })
    await waitFor(() => expect(copyButton).toBeEnabled())
    fireEvent.click(copyButton)

    await waitFor(() =>
      expect(
        screen.queryByText("chat.errors.diagnostics_copied")
      ).not.toBeInTheDocument()
    )
  })

  it("reads the enabled flag from provider config, not from discovery success", async () => {
    ;(extensionRpcClient.call as any).mockImplementation(
      async (method: RpcMethod) => {
        if (method === RpcMethod.ProvidersList) {
          // Discovery below runs with enabledOnly:false and succeeds anyway, so
          // only the config read can answer this honestly.
          return { providers: [{ id: "ollama", enabled: false }] }
        }
        if (method === RpcMethod.ProvidersListModels) {
          return { models: [{ name: "qwen3" }], failures: [] }
        }
        if (method === RpcMethod.ProvidersTestConnection) {
          return {
            providerId: "ollama",
            reachable: true,
            modelCount: 1,
            modelListSupported: true,
            latencyMs: 4
          }
        }
        return { bundle: undefined }
      }
    )

    render(
      <ChatErrorReportAction
        msg={{
          role: "assistant",
          content: "Ollama returned 500",
          error: {
            code: "OLC-PROVIDER-HTTP",
            status: 500,
            providerId: "ollama",
            model: "qwen3"
          }
        }}
      />
    )

    fireEvent.click(
      screen.getByRole("button", { name: "chat.errors.open_issue" })
    )

    await waitFor(() => expect(openExternalUrl).toHaveBeenCalledOnce())
    const body =
      new URL(vi.mocked(openExternalUrl).mock.calls[0][0]).searchParams.get(
        "body"
      ) || ""
    expect(body).toContain("- Provider enabled: no")
    expect(body).toContain("- Provider reachable: yes")
  })

  it("does not read a model list nothing contacted as either reachable or not", async () => {
    // The declared ids fill the list whether or not anything answered, and a
    // provider that already said it has no catalog is not asked again — so the
    // list can arrive without a request leaving the browser. A chat-only
    // gateway and a mistyped base URL are indistinguishable from here, and
    // either verdict sends whoever reads the report after the wrong thing.
    ;(extensionRpcClient.call as any).mockImplementation(
      async (method: RpcMethod) => {
        if (method === RpcMethod.ProvidersListModels) {
          return { models: [{ name: "declared-model" }], failures: [] }
        }
        if (method === RpcMethod.ProvidersTestConnection) {
          return {
            providerId: "custom:openai:remote",
            reachable: false,
            modelCount: 1,
            modelListSupported: false,
            latencyMs: 2
          }
        }
        return { bundle: undefined }
      }
    )

    render(
      <ChatErrorReportAction
        msg={{
          role: "assistant",
          content: "Provider returned 404",
          error: {
            code: "OLC-PROVIDER-HTTP",
            status: 404,
            providerId: "custom:openai:remote",
            model: "declared-model"
          }
        }}
      />
    )

    fireEvent.click(
      screen.getByRole("button", { name: "chat.errors.open_issue" })
    )

    await waitFor(() => expect(openExternalUrl).toHaveBeenCalledOnce())
    const body =
      new URL(vi.mocked(openExternalUrl).mock.calls[0][0]).searchParams.get(
        "body"
      ) || ""
    expect(body).toContain("- Provider reachable: not checked")
  })

  it("reports a connection check that failed as unreachable", async () => {
    ;(extensionRpcClient.call as any).mockImplementation(
      async (method: RpcMethod) => {
        if (method === RpcMethod.ProvidersListModels) {
          return { models: [{ name: "qwen3" }], failures: [] }
        }
        if (method === RpcMethod.ProvidersTestConnection) {
          throw new Error("Failed to fetch")
        }
        return { bundle: undefined }
      }
    )

    render(
      <ChatErrorReportAction
        msg={{
          role: "assistant",
          content: "Ollama refused",
          error: {
            code: "OLC-PROVIDER-HTTP",
            status: 500,
            providerId: "ollama",
            model: "qwen3"
          }
        }}
      />
    )

    fireEvent.click(
      screen.getByRole("button", { name: "chat.errors.open_issue" })
    )

    await waitFor(() => expect(openExternalUrl).toHaveBeenCalledOnce())
    const body =
      new URL(vi.mocked(openExternalUrl).mock.calls[0][0]).searchParams.get(
        "body"
      ) || ""
    expect(body).toContain("- Provider reachable: no")
  })

  it("drops a config-mutating recovery action once the failure is stale", () => {
    ;(extensionRpcClient.call as any).mockResolvedValue({ bundle: undefined })
    const onRetry = vi.fn()

    render(
      <ChatErrorReportAction
        onRetry={onRetry}
        msg={{
          role: "assistant",
          content: "Provider disabled",
          // Two hours old: scrolled-back history, not a live failure.
          timestamp: Date.now() - 2 * 60 * 60 * 1000,
          error: {
            code: "OLC-PROVIDER-DISABLED",
            recoveryAction: "enable-provider",
            providerId: "ollama",
            providerName: "Ollama"
          }
        }}
      />
    )

    expect(
      screen.queryByRole("button", { name: "chat.errors.enable_provider" })
    ).not.toBeInTheDocument()
    // Degrades to the read-only deep link rather than to nothing.
    expect(
      screen.getByRole("button", { name: "settings.shortcuts.open_settings" })
    ).toBeInTheDocument()
  })

  it("keeps the in-place fix on a fresh failure", () => {
    ;(extensionRpcClient.call as any).mockResolvedValue({ bundle: undefined })

    render(
      <ChatErrorReportAction
        onRetry={vi.fn()}
        msg={{
          role: "assistant",
          content: "Provider disabled",
          timestamp: Date.now() - 5_000,
          error: {
            code: "OLC-PROVIDER-DISABLED",
            recoveryAction: "enable-provider",
            providerId: "ollama",
            providerName: "Ollama"
          }
        }}
      />
    )

    expect(
      screen.getByRole("button", { name: "chat.errors.enable_provider" })
    ).toBeInTheDocument()
  })

  it("opens focused recovery settings", () => {
    render(
      <ChatErrorReportAction
        sessionId="session-123"
        msg={{
          role: "assistant",
          content: "Provider disabled",
          error: {
            code: "OLC-PROVIDER-DISABLED",
            recoveryAction: "enable-provider"
          }
        }}
      />
    )

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.shortcuts.open_settings"
      })
    )
    expect(openOptionsInTab).toHaveBeenCalledWith(
      "chrome-extension://test/options.html?tab=models&focus=provider-enabled"
    )
  })
})
