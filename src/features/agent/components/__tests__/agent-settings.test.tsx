import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useSetting } from "@/hooks/use-setting"
import { SETTINGS } from "@/lib/storage/settings"
import { AgentSettings } from "../agent-settings"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock("@/hooks/use-setting", () => ({ useSetting: vi.fn() }))

const providerModels = vi.hoisted(() => ({
  models: [] as {
    name: string
    providerId?: string
    providerName?: string
    details?: { families?: string[] }
  }[]
}))

vi.mock("@/features/model/hooks/use-provider-models", () => ({
  useProviderModels: () => ({ models: providerModels.models })
}))

vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select
      value={value}
      onChange={(event) => onValueChange(event.target.value)}>
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

const SAME = "agent.settings.completion_reviewer.same_as_run"

const reviewerSelect = (): HTMLSelectElement => {
  const select = screen
    .getAllByRole("combobox")
    .find((element) => element.textContent?.includes(SAME))
  if (!select) throw new Error("reviewer select not rendered")
  return select as HTMLSelectElement
}

describe("AgentSettings completion reviewer", () => {
  const setReviewer = vi.fn()
  let reviewer: { providerId: string; modelId: string } | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    reviewer = null
    providerModels.models = [
      { name: "qwen3", providerId: "ollama", providerName: "Ollama" },
      { name: "qwen3", providerId: "custom:lab", providerName: "Lab" },
      { name: "nomic-embed-text", providerId: "ollama" }
    ]
    vi.mocked(useSetting).mockImplementation(((setting: unknown) =>
      setting === SETTINGS.AGENT_COMPLETION_REVIEWER
        ? [reviewer, setReviewer, { isLoading: false }]
        : [undefined, vi.fn(), { isLoading: false }]) as never)
  })

  it("defaults to the run's own model and lists chat models per provider", () => {
    render(<AgentSettings />)
    const select = reviewerSelect()
    expect(select.value).toBe("same")
    const labels = [...select.options].map((option) => option.textContent)
    expect(labels).toEqual([SAME, "qwen3 · Ollama", "qwen3 · Lab"])
  })

  it("saves the provider and model together, and clears back to the run's", () => {
    render(<AgentSettings />)
    const select = reviewerSelect()
    const lab = [...select.options].find(
      (option) => option.textContent === "qwen3 · Lab"
    )
    fireEvent.change(select, { target: { value: lab?.value } })
    expect(setReviewer).toHaveBeenLastCalledWith({
      providerId: "custom:lab",
      modelId: "qwen3"
    })
    fireEvent.change(select, { target: { value: "same" } })
    expect(setReviewer).toHaveBeenLastCalledWith(null)
  })

  it("keeps a saved reviewer selectable after its provider stops listing it", () => {
    reviewer = { providerId: "custom:gone", modelId: "judge-1" }
    render(<AgentSettings />)
    const select = reviewerSelect()
    expect(select.selectedOptions[0]?.textContent).toBe("judge-1")
  })
})
