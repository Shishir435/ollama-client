import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { RpcMethod } from "@/protocol/rpc"
import { FirstRunPermissionsDialog } from "../first-run-permissions-dialog"

const onboarding = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  selectProvider: vi.fn(),
  selectModel: vi.fn(),
  skip: vi.fn()
}))
vi.mock("@/lib/onboarding/state", () => ({
  getOnboardingState: onboarding.get,
  updateOnboardingState: onboarding.update,
  selectOnboardingProvider: onboarding.selectProvider,
  selectOnboardingModel: onboarding.selectModel,
  skipOnboarding: onboarding.skip
}))

const rpc = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock("@/protocol/extension-client", () => ({
  extensionRpcClient: rpc
}))

const api = vi.hoisted(() => ({
  openOptionsInTab: vi.fn(),
  getURL: vi.fn((path: string) => `chrome-extension://test/${path}`)
}))
vi.mock("@/lib/browser-api", () => ({
  openOptionsInTab: api.openOptionsInTab,
  runtime: { getURL: api.getURL }
}))

vi.mock("@/lib/providers/selected-model", () => ({
  saveSelectedModelRef: vi.fn()
}))

const chat = vi.hoisted(() => ({
  createSession: vi.fn(),
  setCurrentSessionId: vi.fn(),
  queueChatSend: vi.fn()
}))
vi.mock("@/features/sessions/stores/chat-session-store", () => ({
  useChatSessions: () => ({
    createSession: chat.createSession,
    setCurrentSessionId: chat.setCurrentSessionId
  })
}))
vi.mock("@/features/chat/stores/chat-input-store", () => ({
  usePendingChatSend: () => ({ queueChatSend: chat.queueChatSend })
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() })
}))

beforeEach(() => {
  vi.clearAllMocks()
  onboarding.get.mockResolvedValue({ version: 2, stage: "privacy" })
  onboarding.update.mockImplementation(
    async ({ stage }: { stage: string }) => ({
      version: 2,
      stage
    })
  )
  onboarding.selectProvider.mockResolvedValue(undefined)
  onboarding.selectModel.mockResolvedValue(undefined)
  onboarding.skip.mockResolvedValue(undefined)
  chat.createSession.mockResolvedValue("11111111-1111-4111-8111-111111111111")
  rpc.call.mockImplementation(async (method: RpcMethod) => {
    if (method === RpcMethod.ProvidersList) {
      return {
        providers: [
          {
            id: "ollama",
            type: "ollama",
            enabled: true,
            name: "Ollama",
            baseUrl: "http://localhost:11434",
            hasApiKey: false
          }
        ]
      }
    }
    if (method === RpcMethod.ProvidersTestConnection) {
      return {
        providerId: "ollama",
        reachable: true,
        modelCount: 1,
        latencyMs: 1
      }
    }
    return {
      models: [
        {
          name: "qwen3",
          model: "qwen3",
          modified_at: "",
          size: 0,
          digest: "",
          providerId: "ollama",
          details: {
            parent_model: "",
            format: "gguf",
            family: "qwen",
            families: ["qwen"],
            parameter_size: "",
            quantization_level: ""
          }
        }
      ],
      failures: []
    }
  })
})

describe("FirstRunPermissionsDialog", () => {
  it("shows resumable privacy onboarding for a new profile", async () => {
    render(<FirstRunPermissionsDialog />)

    await waitFor(() =>
      expect(screen.getByText("onboarding.privacy.title")).toBeTruthy()
    )
    fireEvent.click(screen.getByText("onboarding.continue"))
    expect(onboarding.update).toHaveBeenCalledWith({
      stage: "provider-choice"
    })
  })

  it("stays hidden for completed onboarding", async () => {
    onboarding.get.mockResolvedValue({
      version: 2,
      stage: "complete",
      completedAt: 1
    })
    render(<FirstRunPermissionsDialog />)

    await waitFor(() => expect(onboarding.get).toHaveBeenCalled())
    expect(screen.queryByText("onboarding.privacy.title")).toBeNull()
    expect(rpc.call).not.toHaveBeenCalled()
  })

  it("selects and tests providers through background RPC", async () => {
    render(<FirstRunPermissionsDialog />)
    await waitFor(() =>
      expect(screen.getByText("onboarding.privacy.title")).toBeTruthy()
    )

    fireEvent.click(screen.getByText("onboarding.continue"))
    fireEvent.click(await screen.findByText("Ollama"))
    await screen.findByText("onboarding.provider.connect_title")
    fireEvent.click(screen.getByText("settings.providers.test"))

    await waitFor(() =>
      expect(rpc.call).toHaveBeenCalledWith(RpcMethod.ProvidersTestConnection, {
        target: "stored",
        providerId: "ollama"
      })
    )
    expect(rpc.call).toHaveBeenCalledWith(RpcMethod.ProvidersListModels, {
      providerId: "ollama"
    })
  })

  it("records explicit skip without treating dialog close as completion", async () => {
    render(<FirstRunPermissionsDialog />)
    await screen.findByText("onboarding.privacy.title")
    fireEvent.click(screen.getByText("onboarding.provider.skip"))
    expect(onboarding.skip).toHaveBeenCalledOnce()
  })

  it("creates a chat and prefills the onboarding prompt", async () => {
    onboarding.get.mockResolvedValue({
      version: 2,
      stage: "test-chat",
      providerId: "ollama",
      modelRef: { providerId: "ollama", modelId: "qwen3" }
    })
    render(<FirstRunPermissionsDialog />)

    fireEvent.click(await screen.findByText("onboarding.test_chat.open_chat"))

    await waitFor(() => expect(chat.createSession).toHaveBeenCalledOnce())
    expect(onboarding.update).toHaveBeenCalledWith({
      testSessionId: "11111111-1111-4111-8111-111111111111"
    })
    expect(chat.queueChatSend).toHaveBeenCalledWith(
      "onboarding.test_chat.prompt"
    )
  })

  it("resumes the existing onboarding chat without creating a duplicate", async () => {
    const testSessionId = "22222222-2222-4222-8222-222222222222"
    onboarding.get.mockResolvedValue({
      version: 2,
      stage: "test-chat",
      providerId: "ollama",
      modelRef: { providerId: "ollama", modelId: "qwen3" },
      testSessionId
    })
    render(<FirstRunPermissionsDialog />)

    fireEvent.click(await screen.findByText("onboarding.test_chat.open_chat"))

    expect(chat.setCurrentSessionId).toHaveBeenCalledWith(testSessionId)
    expect(chat.createSession).not.toHaveBeenCalled()
    expect(chat.queueChatSend).toHaveBeenCalledWith(
      "onboarding.test_chat.prompt"
    )
  })
})
