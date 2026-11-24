import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ModelPullStatus } from "@/features/model/hooks/use-model-pull"
import { ModelPullInline } from "../model-pull-inline"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key
  })
}))
vi.mock("@/features/chat/components/copy-button", () => ({
  CopyButton: ({ text }: { text: string }) => <span>copy:{text}</span>
}))

const pull = vi.hoisted(() => ({
  state: {
    pullingModel: null as string | null,
    progress: null as ModelPullStatus | null,
    pullModel: vi.fn(),
    cancelPull: vi.fn()
  }
}))
vi.mock("@/features/model/hooks/use-model-pull", () => ({
  useModelPull: () => pull.state
}))

describe("ModelPullInline", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pull.state.pullingModel = null
    pull.state.progress = null
  })

  it("pulls the suggested small model for Ollama on one press", () => {
    render(<ModelPullInline />)

    fireEvent.click(screen.getByRole("button", { name: "model.pull.action" }))

    expect(pull.state.pullModel).toHaveBeenCalledWith("llama3.2", "ollama")
    expect(screen.getByText("copy:ollama pull llama3.2")).toBeTruthy()
  })

  it("keeps the terminal command in step with the name being typed", () => {
    render(<ModelPullInline />)

    fireEvent.change(screen.getByLabelText("model.pull.name_label"), {
      target: { value: "qwen3:8b" }
    })

    expect(screen.getByText("copy:ollama pull qwen3:8b")).toBeTruthy()
  })

  it("shows progress with a cancel while downloading", () => {
    pull.state.pullingModel = "llama3.2"
    pull.state.progress = { phase: "pulling", percent: 42, text: "pulling" }
    render(<ModelPullInline />)

    expect(screen.getByText(/42/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "model.pull.cancel" }))
    expect(pull.state.cancelPull).toHaveBeenCalledOnce()
    expect(
      screen.queryByRole("button", { name: "model.pull.action" })
    ).toBeNull()
  })

  it("starts collapsed as a single entry when asked to be compact", () => {
    render(<ModelPullInline collapsible showCommand={false} />)

    expect(screen.queryByLabelText("model.pull.name_label")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "model.pull.open" }))
    expect(screen.getByLabelText("model.pull.name_label")).toBeTruthy()
    expect(screen.queryByText(/^copy:/)).toBeNull()
  })

  it("reports a finished download once so the caller can re-list models", () => {
    const onPulled = vi.fn()
    const { rerender } = render(<ModelPullInline onPulled={onPulled} />)
    fireEvent.click(screen.getByRole("button", { name: "model.pull.action" }))

    pull.state.progress = { phase: "success" }
    rerender(<ModelPullInline onPulled={onPulled} />)
    rerender(<ModelPullInline onPulled={onPulled} />)

    expect(onPulled).toHaveBeenCalledTimes(1)
    expect(onPulled).toHaveBeenCalledWith("llama3.2")
  })
})
