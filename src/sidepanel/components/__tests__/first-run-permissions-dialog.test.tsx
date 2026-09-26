import { RpcMethod } from "@ollama-client/contracts/rpc"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
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

vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select
      aria-label="model"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}>
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => (
    <option value={value}>{children}</option>
  )
}))

const resumeModels = (providerId = "ollama") =>
  onboarding.get.mockResolvedValue({
    version: 2,
    stage: "model-choice",
    providerId,
    modelRef: { providerId, modelId: "qwen3" }
  })

it("enables the chosen provider before committing its model", async () => {
  resumeModels()
  render(<FirstRunPermissionsDialog />)
  const use = await screen.findByRole("button", {
    name: "onboarding.model.use_unverified"
  })
  await waitFor(() => expect(use).not.toBeDisabled())
  fireEvent.click(use)
  await waitFor(() =>
    expect(onboarding.selectModel).toHaveBeenCalledWith({
      providerId: "ollama",
      modelId: "qwen3"
    })
  )
  expect(rpc.call).toHaveBeenCalledWith(RpcMethod.ProvidersSetEnabled, {
    providerId: "ollama",
    enabled: true
  })
})
it("refreshes an empty model screen without a back-navigation detour", async () => {
  resumeModels()
  const original = rpc.call.getMockImplementation()
  if (!original) throw new Error("Missing RPC fixture")
  let available = false
  rpc.call.mockImplementation(async (method, ...args) =>
    method === RpcMethod.ProvidersListModels && !available
      ? { models: [], failures: [] }
      : original(method, ...args)
  )
  render(<FirstRunPermissionsDialog />)
  await screen.findByText("onboarding.model.none")
  expect(
    screen.getByRole("button", { name: "onboarding.model.use_unverified" })
  ).toBeDisabled()
  fireEvent.click(
    screen.getByRole("button", { name: "onboarding.provider.open_setup" })
  )
  expect(api.openOptionsInTab).toHaveBeenCalled()
  available = true
  fireEvent.click(
    screen.getByRole("button", { name: "onboarding.model.refresh" })
  )
  await screen.findByRole("option", { name: /qwen3/ })
})
it("does not present a catalog-less stored test as verified", async () => {
  resumeModels()
  const original = rpc.call.getMockImplementation()
  if (!original) throw new Error("Missing RPC fixture")
  rpc.call.mockImplementation(async (method, ...args) =>
    method === RpcMethod.ProvidersTestConnection
      ? { reachable: false, modelListSupported: false }
      : original(method, ...args)
  )
  render(<FirstRunPermissionsDialog />)
  fireEvent.click(
    await screen.findByRole("button", { name: "onboarding.model.refresh" })
  )
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "onboarding.model.use_unverified" })
    ).not.toBeDisabled()
  )
  expect(screen.getByText("onboarding.provider.unverified")).toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: "onboarding.model.use" })
  ).toBeNull()
})
it("drops an old model when the user changes providers", async () => {
  resumeModels()
  const original = rpc.call.getMockImplementation()
  if (!original) throw new Error("Missing RPC fixture")
  rpc.call.mockImplementation(async (method, ...args) =>
    method === RpcMethod.ProvidersList
      ? {
          providers: [
            { id: "ollama", name: "Ollama", type: "ollama", enabled: true },
            {
              id: "lm-studio",
              name: "LM Studio",
              type: "openai-compatible",
              enabled: false
            }
          ]
        }
      : method === RpcMethod.ProvidersListModels &&
          args[0]?.providerId === "lm-studio"
        ? { models: [], failures: [] }
        : original(method, ...args)
  )
  render(<FirstRunPermissionsDialog />)
  await screen.findByRole("option", { name: /qwen3/ })
  fireEvent.click(screen.getByRole("button", { name: "common.actions.back" }))
  await screen.findByText("onboarding.provider.connect_title")
  fireEvent.click(screen.getByRole("button", { name: "common.actions.back" }))
  fireEvent.click(await screen.findByText("LM Studio"))
  fireEvent.click(
    await screen.findByRole("button", { name: "settings.providers.test" })
  )
  await screen.findByText("onboarding.model.none")
  expect(
    screen.getByRole("button", { name: "onboarding.model.use" })
  ).toBeDisabled()
  expect(onboarding.selectModel).not.toHaveBeenCalled()
})

it("hides MiniLM and other embedding models from the onboarding chat picker", async () => {
  resumeModels()
  const original = rpc.call.getMockImplementation()
  if (!original) throw new Error("Missing RPC fixture")
  rpc.call.mockImplementation(async (method, ...args) =>
    method === RpcMethod.ProvidersListModels
      ? {
          models: [
            { name: "all-minilm:latest", providerId: "ollama" },
            { name: "nomic-embed-text:latest", providerId: "ollama" },
            { name: "bge-m3:latest", providerId: "ollama" },
            {
              name: "opaque-vector-model",
              providerId: "ollama",
              capabilityHints: { modelType: "embedding" }
            },
            { name: "gemma4:2b-mlx", providerId: "ollama" }
          ],
          failures: []
        }
      : original(method, ...args)
  )
  render(<FirstRunPermissionsDialog />)
  await screen.findByRole("option", { name: /gemma4:2b-mlx/ })
  for (const name of ["all-minilm", "nomic-embed", "bge-m3", "opaque-vector"])
    expect(screen.queryByRole("option", { name: new RegExp(name) })).toBeNull()
  expect(
    screen.getByRole("button", { name: "onboarding.model.use_unverified" })
  ).toBeDisabled()
})
