import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { DEFAULT_EMBEDDING_CONFIG } from "@/lib/constants"
import { EmbeddingModelSelector } from "../embedding-config/embedding-model-selector"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children, disabled }: any) => (
    <select
      aria-label="embedding model"
      disabled={disabled}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectLabel: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectGroup: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => (
    <option value={value}>{children}</option>
  )
}))

describe("embedding provider identity", () => {
  it("keeps same-named recommended models distinct and passes the selected provider to confirmation", () => {
    const selected = vi.fn()
    render(
      <EmbeddingModelSelector
        selectedModel="all-minilm:latest"
        config={{
          ...DEFAULT_EMBEDDING_CONFIG,
          sharedEmbeddingProviderId: "custom:first"
        }}
        embeddingModels={
          [
            {
              name: "all-minilm:latest",
              providerId: "custom:first",
              providerName: "First"
            },
            {
              name: "all-minilm:latest",
              providerId: "custom:second",
              providerName: "Second"
            }
          ] as any
        }
        hasAdvancedModels={false}
        isRebuilding={false}
        rebuildProgress={null}
        onModelSelected={selected}
        onToggleShowAdvanced={vi.fn()}
      />
    )
    const second = screen.getByRole("option", {
      name: "all-minilm:latest (Second)"
    }) as HTMLOptionElement
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: second.value }
    })
    expect(selected).toHaveBeenCalledWith("all-minilm:latest", "custom:second")
    expect(
      screen.getByRole("option", { name: "all-minilm:latest (First)" })
    ).toBeInTheDocument()
  })
})

it.each([true, false])(
  "keeps the selector disabled and controls the starting notice explicitly (%s)",
  (showRebuildNotice) => {
    render(
      <EmbeddingModelSelector
        selectedModel="all-minilm:latest"
        config={DEFAULT_EMBEDDING_CONFIG}
        embeddingModels={[]}
        hasAdvancedModels={false}
        isRebuilding
        showRebuildNotice={showRebuildNotice}
        rebuildProgress={null}
        onModelSelected={vi.fn()}
        onToggleShowAdvanced={vi.fn()}
      />
    )
    expect(screen.getByRole("combobox")).toBeDisabled()
    const notice = screen.queryByText(
      "settings.embeddings.rebuild_index.status_starting"
    )
    if (showRebuildNotice) expect(notice).toBeInTheDocument()
    else expect(notice).toBeNull()
  }
)
