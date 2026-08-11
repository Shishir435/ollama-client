import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ModelMenu } from "../model-menu"

const { useProviderModelsMock } = vi.hoisted(() => ({
  useProviderModelsMock: vi.fn()
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    data,
    itemContent
  }: {
    data: unknown[]
    itemContent: (index: number, item: unknown) => React.ReactNode
  }) => (
    <div data-testid="virtualized-models" data-count={data.length}>
      {data.slice(0, 6).map((item, index) => itemContent(index, item))}
    </div>
  )
}))

vi.mock("@/components/actions", () => ({
  TooltipActionButton: ({
    trigger,
    icon,
    onClick,
    ariaLabel
  }: {
    trigger?: React.ReactElement
    icon?: React.ReactNode
    onClick?: () => void
    ariaLabel?: string
  }) =>
    trigger ?? (
      <button type="button" onClick={onClick} aria-label={ariaLabel}>
        {icon}
      </button>
    )
}))

vi.mock("@/features/model/hooks/use-provider-models", () => ({
  useProviderModels: useProviderModelsMock
}))

vi.mock("@/features/model/hooks/use-provider-icons", () => ({
  useProviderIcons: () => ({})
}))

vi.mock("@/features/model/hooks/use-model-capability-overrides", () => ({
  useModelCapabilityOverrides: () => ({
    resolve: () => ({}),
    getOverride: () => null,
    getProbe: () => null,
    setOverride: vi.fn(),
    clearOverride: vi.fn()
  })
}))

vi.mock("@/features/model/hooks/use-model-capability-tags", () => ({
  modelTagsKey: (providerId: string, model: string) => `${providerId}:${model}`,
  useModelCapabilityTags: () => ({})
}))

vi.mock("../model-capabilities/capability-badges", () => ({
  ModelCapabilityBadges: () => null
}))

vi.mock("../model-capabilities/capability-sheet", () => ({
  ModelCapabilitySheet: () => null
}))

const remoteModels = Array.from({ length: 455 }, (_, index) => ({
  name: index === 454 ? "trustedrouter/cheap" : `remote/model-${index}`,
  model: index === 454 ? "trustedrouter/cheap" : `remote/model-${index}`,
  size: 0,
  providerId: "custom:openai:remote",
  providerName: "Trusted Router",
  details: { family: "remote" }
}))

describe("ModelMenu", () => {
  beforeEach(() => {
    useProviderModelsMock.mockReturnValue({
      models: [
        ...remoteModels,
        {
          name: "gemma-local",
          model: "gemma-local",
          size: 0,
          providerId: "ollama",
          providerName: "Ollama",
          details: { family: "gemma" }
        }
      ],
      refresh: vi.fn(),
      isLoading: false,
      selectedModel: "gemma-local",
      selectedModelRef: { providerId: "ollama", modelId: "gemma-local" },
      setSelectedModel: vi.fn(),
      selectionConflictModel: null,
      clearSelectionConflict: vi.fn(),
      unavailableProviders: []
    })
  })

  it("switches provider catalogs while the row renderer stays virtualized", async () => {
    render(
      <ModelMenu
        trigger={<button type="button">Choose model</button>}
        tooltipTextContent="Choose model"
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Choose model" }))

    await waitFor(() => {
      expect(screen.getByTestId("virtualized-models")).toHaveAttribute(
        "data-count",
        "1"
      )
    })

    fireEvent.click(screen.getByRole("button", { name: "Trusted Router" }))

    expect(screen.getByTestId("virtualized-models")).toHaveAttribute(
      "data-count",
      "455"
    )
    expect(screen.queryByText("remote/model-6")).not.toBeInTheDocument()

    fireEvent.change(
      screen.getByRole("textbox", { name: "model.menu.search_placeholder" }),
      {
        target: { value: "trustedrouter/cheap" }
      }
    )

    expect(screen.getByTestId("virtualized-models")).toHaveAttribute(
      "data-count",
      "1"
    )
    expect(screen.getByText("trustedrouter/cheap")).toBeInTheDocument()
  })

  it("scrolls the provider rail without a visible thumb and keeps all-models pinned", () => {
    render(
      <ModelMenu
        trigger={<button type="button">Choose model</button>}
        tooltipTextContent="Choose model"
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Choose model" }))

    const rail = screen.getByTestId("provider-rail-scroll")
    expect(rail.className).toContain("overflow-y-auto")
    expect(rail.className).toContain("scrollbar-none")

    expect(rail).toContainElement(
      screen.getByRole("button", { name: "Trusted Router" })
    )
    expect(rail).toContainElement(
      screen.getByRole("button", { name: "Ollama" })
    )
    expect(rail).not.toContainElement(
      screen.getByRole("button", { name: "model.menu.models_label" })
    )
  })
})
