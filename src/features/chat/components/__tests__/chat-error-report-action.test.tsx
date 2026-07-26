import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ChatErrorReportAction } from "@/features/chat/components/chat-error-report-action"
import { openExternalUrl, openOptionsInTab } from "@/lib/browser-api"
import { extensionRpcClient } from "@/protocol/extension-client"
import { RpcMethod } from "@/protocol/rpc"

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
  it("runs safe diagnostics automatically and includes incident data", async () => {
    ;(extensionRpcClient.call as any).mockImplementation(
      async (method: RpcMethod) => {
        if (method === RpcMethod.ProvidersListModels) {
          return {
            models: [{ name: "/Users/alice/Models/qwen.gguf" }],
            failures: []
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

    await waitFor(() =>
      expect(extensionRpcClient.call).toHaveBeenCalledWith(
        RpcMethod.DiagnosticsGetBundle,
        {}
      )
    )
    fireEvent.click(
      screen.getByRole("button", { name: "chat.errors.open_issue" })
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
        events: []
      }
    })
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined)

    render(
      <ChatErrorReportAction
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

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    expect(writeText.mock.calls[0][0]).toContain(
      "- Error code: OLC-PROVIDER-HTTP"
    )
    expect(writeText.mock.calls[0][0]).toContain("- Incident ID: INC-ABC12345")
  })

  it("opens focused recovery settings", () => {
    render(
      <ChatErrorReportAction
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
