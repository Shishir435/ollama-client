import { RpcMethod } from "@ollama-client/contracts/rpc"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createAppError } from "@/lib/error-utils"
import { ProviderStatusCard } from "../provider-status-card"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock("@/components/setup-guide-link", () => ({
  SetupGuideLink: () => null
}))
vi.mock("@/features/chat/components/copy-button", () => ({
  CopyButton: () => null
}))
vi.mock("@/features/model/components/model-pull-inline", () => ({
  ModelPullInline: () => <div>inline-pull</div>
}))
vi.mock("@/lib/browser-api", () => ({
  openExternalUrl: vi.fn(),
  openOptionsInTab: vi.fn(),
  runtime: { getURL: (path: string) => path }
}))

const providerModels = vi.hoisted(() => ({
  value: {} as Record<string, unknown>
}))
vi.mock("@/features/model/hooks/use-provider-models", () => ({
  useProviderModels: () => providerModels.value
}))

const rpc = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock("@/protocol/extension-client", () => ({ extensionRpcClient: rpc }))

const unreachable = () => ({
  status: "error",
  refresh: vi.fn(),
  ollamaEnabled: true,
  unavailableProviders: [
    { providerId: "ollama", providerName: "Ollama", code: "request_failed" }
  ]
})

const failWith = (messageKey: string) =>
  rpc.call.mockRejectedValue(
    createAppError("failed", {
      kind: "provider",
      messageKey,
      messageParams: { provider: "Ollama" }
    })
  )

describe("ProviderStatusCard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    providerModels.value = unreachable()
  })

  it("names a stopped server without the origins command", async () => {
    failWith("onboarding.provider.errors.unavailable")
    render(<ProviderStatusCard />)

    await waitFor(() =>
      expect(rpc.call).toHaveBeenCalledWith(RpcMethod.ProvidersTestConnection, {
        target: "stored",
        providerId: "ollama"
      })
    )
    expect(
      screen.getByText("welcome.status.connection_failed.message")
    ).toBeTruthy()
    expect(
      screen.queryByText("onboarding.provider.origins.olc_hint")
    ).toBeNull()
  })

  it("shows the origins command and the olc shortcut when the server refuses us", async () => {
    failWith("onboarding.provider.errors.blocked")
    render(<ProviderStatusCard />)

    await screen.findByText("onboarding.provider.errors.blocked")
    expect(
      screen.getByText("onboarding.provider.origins.olc_hint")
    ).toBeTruthy()
    expect(screen.getByText(/OLLAMA_ORIGINS/)).toBeTruthy()
  })

  it("re-runs the classification when Recheck is pressed", async () => {
    failWith("onboarding.provider.errors.unavailable")
    const refresh = vi.fn()
    providerModels.value = { ...unreachable(), refresh }
    render(<ProviderStatusCard />)
    await waitFor(() => expect(rpc.call).toHaveBeenCalledTimes(1))

    failWith("onboarding.provider.errors.cors")
    fireEvent.click(
      screen.getByRole("button", { name: "onboarding.provider.recheck" })
    )

    expect(refresh).toHaveBeenCalledOnce()
    await screen.findByText("onboarding.provider.errors.cors")
  })

  it("offers an inline pull when Ollama answers with no models", () => {
    providerModels.value = {
      status: "empty",
      refresh: vi.fn(),
      ollamaEnabled: true,
      unavailableProviders: []
    }
    render(<ProviderStatusCard />)

    expect(screen.getByText("inline-pull")).toBeTruthy()
  })
})
