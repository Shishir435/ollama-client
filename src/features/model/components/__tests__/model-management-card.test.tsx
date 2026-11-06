import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ModelManagementCard } from "../model-management-card"

const mocks = vi.hoisted(() => ({
  models: vi.fn(),
  pull: vi.fn(),
  cancel: vi.fn(),
  deleteModel: vi.fn(),
  refresh: vi.fn(),
  progress: { current: null as unknown },
  pulling: { current: null as string | null }
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key
  })
}))
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock("@/features/model/hooks/use-model-pull", () => ({
  useModelPull: () => ({
    pullingModel: mocks.pulling.current,
    progress: mocks.progress.current,
    pullModel: mocks.pull,
    cancelPull: mocks.cancel
  })
}))
vi.mock("@/features/model/hooks/use-provider-models", () => ({
  useProviderModels: () => ({
    models: mocks.models(),
    deleteModel: mocks.deleteModel,
    refresh: mocks.refresh,
    ollamaEnabled: true
  })
}))

const ollamaModel = {
  name: "llama3.2:latest",
  model: "llama3.2:latest",
  size: 2_000_000_000,
  providerId: "ollama"
}
const lmStudioModel = {
  name: "qwen-local",
  model: "qwen-local",
  size: 0,
  providerId: "lmstudio"
}

const renderCard = () =>
  render(
    <TooltipProvider>
      <ModelManagementCard />
    </TooltipProvider>
  )

describe("ModelManagementCard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.models.mockReturnValue([ollamaModel, lmStudioModel])
    mocks.progress.current = null
    mocks.pulling.current = null
  })

  it("starts a download for the typed name against Ollama", () => {
    renderCard()
    const submit = screen.getByRole("button", {
      name: "settings.model_management.download"
    })
    expect(submit).toBeDisabled()

    fireEvent.click(screen.getByRole("button", { name: "qwen3:8b" }))
    fireEvent.click(submit)
    expect(mocks.pull).toHaveBeenCalledWith("qwen3:8b", "ollama")
  })

  it("shows percent progress and a Cancel while downloading", () => {
    mocks.pulling.current = "qwen3:8b"
    mocks.progress.current = {
      phase: "pulling",
      text: "pulling manifest",
      percent: 42
    }
    renderCard()

    expect(screen.getByText(/pulling_percent/)).toHaveTextContent(
      '"percent":42'
    )
    fireEvent.click(
      screen.getByRole("button", { name: "settings.model_management.cancel" })
    )
    expect(mocks.cancel).toHaveBeenCalled()
  })

  it("offers delete only for models of providers that support it", () => {
    renderCard()
    expect(
      screen.getByRole("button", {
        name: /delete_named.*llama3\.2:latest/
      })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /delete_named.*qwen-local/ })
    ).toBeNull()
  })

  it("asks before deleting, then deletes through the hook", async () => {
    mocks.deleteModel.mockResolvedValue(undefined)
    renderCard()

    fireEvent.click(
      screen.getByRole("button", { name: /delete_named.*llama3\.2:latest/ })
    )
    expect(mocks.deleteModel).not.toHaveBeenCalled()
    fireEvent.click(
      await screen.findByRole("button", {
        name: "settings.model_management.delete"
      })
    )
    await waitFor(() =>
      expect(mocks.deleteModel).toHaveBeenCalledWith({
        modelName: "llama3.2:latest",
        providerId: "ollama"
      })
    )
  })
})
