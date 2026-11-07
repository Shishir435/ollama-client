import { ProvidersListModelsResultSchema } from "@ollama-client/contracts/provider-rpc"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ModelMenu } from "../model-menu"

const { useProviderModelsMock } = vi.hoisted(() => ({
  useProviderModelsMock: vi.fn()
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key
  })
}))

vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    data,
    computeItemKey,
    itemContent
  }: {
    data: unknown[]
    computeItemKey: (index: number, item: unknown) => string
    itemContent: (index: number, item: unknown) => React.ReactNode
  }) => (
    <div data-testid="virtualized-models" data-count={data.length}>
      {data.slice(0, 6).map((item, index) => (
        <div key={computeItemKey(index, item)}>{itemContent(index, item)}</div>
      ))}
    </div>
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
      refreshProvider: vi.fn(async () => undefined),
      refreshStale: vi.fn(async () => undefined),
      isLoading: false,
      selectedModel: "gemma-local",
      selectedModelRef: { providerId: "ollama", modelId: "gemma-local" },
      setSelectedModel: vi.fn(),
      selectionConflictModel: null,
      clearSelectionConflict: vi.fn(),
      unavailableProviders: [],
      unverifiedProviders: []
    })
  })

  it.each(["provider", "all"])(
    "reverses an already ascending catalog on the first click and restores it on the second in the %s view",
    async (view) => {
      const names = [
        "Alpha",
        "beta",
        "delta",
        "epsilon",
        "gamma",
        "theta",
        "xi",
        "zeta"
      ]
      const models = names.map((name) => ({
        name,
        model: name,
        providerId: "ollama",
        size: 0
      }))
      useProviderModelsMock.mockReturnValue({
        ...useProviderModelsMock(),
        models
      })
      render(<ModelMenu tooltipTextContent="Choose model" />)
      fireEvent.click(screen.getByRole("button", { name: "Choose model" }))
      const search = await screen.findByRole("combobox")
      if (view === "all") {
        fireEvent.click(
          screen.getByRole("button", { name: "model.menu.models_label" })
        )
      }
      const sort = screen.getByRole("button", { name: "model.menu.sort_za" })
      const order = () =>
        screen
          .getAllByRole("option")
          .map((row) => row.querySelector("[title]")?.getAttribute("title"))
      const expectFirstHighlighted = () => {
        const first = screen.getAllByRole("option")[0]
        expect(first).toHaveAttribute("aria-selected", "true")
        expect(search).toHaveAttribute("aria-activedescendant", first.id)
      }
      expect(screen.getByTestId("virtualized-models")).toHaveAttribute(
        "data-count",
        "8"
      )
      expect(order()).toEqual(names.slice(0, 6))
      expect(sort).toHaveTextContent("A–Z")
      expect(sort.querySelector("svg")).toHaveClass("lucide-arrow-down-az")
      fireEvent.keyDown(search, { key: "ArrowDown" })
      expect(screen.getAllByRole("option")[1]).toHaveAttribute(
        "aria-selected",
        "true"
      )
      fireEvent.click(sort)
      expect(order()).toEqual([...names].reverse().slice(0, 6))
      expect(sort).toHaveAccessibleName("model.menu.sort_az")
      expect(sort).toHaveTextContent("Z–A")
      expect(sort.querySelector("svg")).toHaveClass("lucide-arrow-down-za")
      expectFirstHighlighted()
      fireEvent.click(sort)
      expect(order()).toEqual(names.slice(0, 6))
      expect(sort).toHaveAccessibleName("model.menu.sort_za")
      expect(sort).toHaveTextContent("A–Z")
      expectFirstHighlighted()
      expect(models.map((model) => model.name)).toEqual(names)
    }
  )

  it("sorts filtered names naturally and selects the highlighted row in descending order", async () => {
    // Match the RPC's lexical ascending order, including model10 before model2.
    const names = ["Alpha", "model10", "Model2", "zeta"]
    const models = names.map((name) => ({
      name,
      model: name,
      providerId: "ollama",
      size: 0
    }))
    const setSelectedModel = vi.fn()
    useProviderModelsMock.mockReturnValue({
      ...useProviderModelsMock(),
      models,
      setSelectedModel
    })
    render(<ModelMenu tooltipTextContent="Choose model" />)
    fireEvent.click(screen.getByRole("button", { name: "Choose model" }))
    const search = await screen.findByRole("combobox")
    fireEvent.change(search, { target: { value: "model" } })
    const order = () =>
      screen
        .getAllByRole("option")
        .map((row) => row.querySelector("[title]")?.getAttribute("title"))
    expect(order()).toEqual(["Model2", "model10"])
    fireEvent.click(screen.getByRole("button", { name: "model.menu.sort_za" }))
    expect(order()).toEqual(["model10", "Model2"])
    fireEvent.click(screen.getByRole("button", { name: "model.menu.sort_az" }))
    expect(order()).toEqual(["Model2", "model10"])
    fireEvent.click(screen.getByRole("button", { name: "model.menu.sort_za" }))
    fireEvent.keyDown(search, { key: "ArrowDown" })
    const second = screen.getAllByRole("option")[1]
    expect(second).toHaveAttribute("aria-selected", "true")
    expect(search).toHaveAttribute("aria-activedescendant", second.id)
    fireEvent.keyDown(search, { key: "Enter" })
    await waitFor(() =>
      expect(setSelectedModel).toHaveBeenCalledWith("Model2", "ollama")
    )
    expect(models.map((model) => model.name)).toEqual(names)
  })

  it("breaks identical-name ties by provider consistently in both directions", async () => {
    useProviderModelsMock.mockReturnValue({
      ...useProviderModelsMock(),
      models: ["custom:b", "custom:a"].map((providerId) => ({
        name: "model2",
        model: "model2",
        providerId,
        providerName: providerId,
        size: 0
      }))
    })
    render(<ModelMenu tooltipTextContent="Choose model" />)
    fireEvent.click(screen.getByRole("button", { name: "Choose model" }))
    fireEvent.click(
      await screen.findByRole("button", { name: "model.menu.models_label" })
    )
    expect(screen.getAllByRole("option")[0].id).toContain("custom:a:model2")
    fireEvent.click(screen.getByRole("button", { name: "model.menu.sort_za" }))
    expect(screen.getAllByRole("option")[0].id).toContain("custom:b:model2")
  })

  it("labels cloud rows after RPC normalization even when their plan is unreported", async () => {
    const { models } = ProvidersListModelsResultSchema.parse({
      models: [
        {
          name: "beam:cloud",
          providerId: "ollama",
          cloud: {},
          details: { format: "cloud" }
        },
        {
          name: "gemma4:31b-cloud",
          providerId: "ollama",
          cloud: { requiredPlan: "free" }
        },
        {
          name: "kimi-k3:cloud",
          providerId: "ollama",
          cloud: { requiredPlan: "pro" }
        },
        { name: "gemma4:12b", providerId: "ollama" }
      ],
      failures: []
    })
    expect(models[0].cloud).toBeUndefined()
    useProviderModelsMock.mockReturnValue({
      ...useProviderModelsMock(),
      models,
      selectedModel: "beam:cloud",
      selectedModelRef: { providerId: "ollama", modelId: "beam:cloud" }
    })
    render(
      <ModelMenu
        trigger={<button type="button">Choose model</button>}
        tooltipTextContent="Choose model"
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Choose model" }))
    fireEvent.click(await screen.findByRole("button", { name: "Ollama" }))
    expect(
      screen.getByText('model.menu.cloud_badge:{"plan":""}')
    ).toBeInTheDocument()
    expect(
      screen.getByText('model.menu.cloud_badge:{"plan":""}')
    ).toHaveAttribute("title", "model.menu.cloud_plan_unknown")
    expect(
      screen.getByText('model.menu.cloud_badge:{"plan":" · free"}')
    ).toBeInTheDocument()
    expect(
      screen.getByText('model.menu.cloud_badge:{"plan":" · pro"}')
    ).toBeInTheDocument()
    expect(screen.getAllByText(/model.menu.cloud_badge/)).toHaveLength(3)
  })

  /** An empty `/api/tags` is exactly when someone wants cloud models on. */
  it("offers Ollama's cloud toggle while Ollama lists no models", async () => {
    useProviderModelsMock.mockReturnValue({
      ...useProviderModelsMock(),
      models: remoteModels,
      selectedModel: "trustedrouter/cheap",
      selectedModelRef: {
        providerId: "custom:openai:remote",
        modelId: "trustedrouter/cheap"
      },
      ollamaEnabled: true
    })
    render(
      <ModelMenu
        trigger={<button type="button">Choose model</button>}
        tooltipTextContent="Choose model"
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Choose model" }))
    fireEvent.click(await screen.findByRole("button", { name: "Ollama" }))

    const cloudToggle = screen.getByRole("button", {
      name: "model.menu.cloud_models.label"
    })
    await waitFor(() => expect(cloudToggle).toBeEnabled())
    expect(cloudToggle).toHaveAttribute("aria-pressed", "false")
    fireEvent.click(cloudToggle)

    /** Only Ollama reads this setting; every other catalog stays cached. */
    const { refresh, refreshProvider } = useProviderModelsMock.mock.results.at(
      -1
    )!.value as {
      refresh: ReturnType<typeof vi.fn>
      refreshProvider: ReturnType<typeof vi.fn>
    }
    await waitFor(() => expect(refreshProvider).toHaveBeenCalledWith("ollama"))
    await waitFor(() =>
      expect(cloudToggle).toHaveAttribute("aria-pressed", "true")
    )
    fireEvent.click(cloudToggle)
    fireEvent.click(cloudToggle)
    await waitFor(() => expect(refreshProvider).toHaveBeenCalledTimes(3))
    await waitFor(() =>
      expect(cloudToggle).toHaveAttribute("aria-pressed", "true")
    )
    expect(refresh).not.toHaveBeenCalled()
  })

  it("does not advertise its search popover as a listbox", () => {
    render(<ModelMenu tooltipTextContent="Choose model" />)
    expect(
      screen.getByRole("button", { name: "Choose model" })
    ).not.toHaveAttribute("aria-haspopup", "listbox")
  })

  it("re-asks stale catalogs when the menu opens", () => {
    render(
      <ModelMenu
        trigger={<button type="button">Choose model</button>}
        tooltipTextContent="Choose model"
      />
    )
    const { refreshStale } = useProviderModelsMock.mock.results.at(-1)!
      .value as { refreshStale: ReturnType<typeof vi.fn> }
    expect(refreshStale).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Choose model" }))
    expect(refreshStale).toHaveBeenCalledTimes(1)
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
      screen.getByRole("combobox", { name: "model.menu.search_placeholder" }),
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

  it("falls back to an available provider when the active catalog disappears", async () => {
    const initialModels = useProviderModelsMock()
    const { rerender } = render(
      <ModelMenu
        trigger={<button type="button">Choose model</button>}
        tooltipTextContent="Choose model"
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Choose model" }))
    fireEvent.click(screen.getByRole("button", { name: "Trusted Router" }))
    expect(screen.getByTestId("virtualized-models")).toHaveAttribute(
      "data-count",
      "455"
    )

    useProviderModelsMock.mockReturnValue({
      ...initialModels,
      models: initialModels.models.filter(
        (model: { providerId: string }) => model.providerId === "ollama"
      )
    })
    rerender(
      <ModelMenu
        trigger={<button type="button">Choose model</button>}
        tooltipTextContent="Choose model"
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId("virtualized-models")).toHaveAttribute(
        "data-count",
        "1"
      )
    })
    expect(screen.getByText("gemma-local")).toBeInTheDocument()
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

  it("names a rail provider in a tooltip instead of a native title", async () => {
    render(
      <ModelMenu
        trigger={<button type="button">Choose model</button>}
        tooltipTextContent="Choose model"
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Choose model" }))
    const button = screen.getByRole("button", { name: "Ollama" })
    expect(button).not.toHaveAttribute("title")
    fireEvent.pointerEnter(button)
    fireEvent.mouseEnter(button)
    fireEvent.mouseMove(button)
    expect(await screen.findByText(/^Ollama · \d+$/)).toBeInTheDocument()
  })

  it("keeps a provider that timed out in the rail, unverified, with a retry", async () => {
    const refreshProvider = vi.fn(async () => undefined)
    useProviderModelsMock.mockReturnValue({
      ...useProviderModelsMock(),
      refreshProvider,
      unverifiedProviders: [
        {
          providerId: "custom:openai:slow",
          providerName: "Slow Router",
          code: "unverified"
        }
      ]
    })
    render(<ModelMenu tooltipTextContent="Choose model" />)
    fireEvent.click(screen.getByRole("button", { name: "Choose model" }))
    fireEvent.click(screen.getByRole("button", { name: "Slow Router" }))
    expect(
      screen.getByText(/model\.menu\.providers_unverified/)
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/model\.menu\.providers_unreachable/)
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "model.menu.retry" }))
    expect(refreshProvider).toHaveBeenCalledWith("custom:openai:slow")
  })

  it("moves a highlighted row with the arrow keys and selects it with Enter", async () => {
    const setSelectedModel = vi.fn()
    useProviderModelsMock.mockReturnValue({
      ...useProviderModelsMock(),
      setSelectedModel
    })
    render(<ModelMenu tooltipTextContent="Choose model" />)
    fireEvent.click(screen.getByRole("button", { name: "Choose model" }))
    const search = await screen.findByRole("combobox", {
      name: "model.menu.search_placeholder"
    })
    fireEvent.click(screen.getByRole("button", { name: "Trusted Router" }))
    fireEvent.change(search, { target: { value: "remote/model-" } })

    const first = screen.getAllByRole("option")[0]
    expect(first).toHaveAttribute("aria-selected", "true")
    expect(search).toHaveAttribute("aria-activedescendant", first?.id)

    fireEvent.keyDown(search, { key: "ArrowDown" })
    const second = screen.getAllByRole("option")[1]
    expect(second).toHaveAttribute("aria-selected", "true")
    expect(search).toHaveAttribute("aria-activedescendant", second?.id)

    fireEvent.keyDown(search, { key: "Enter" })
    await waitFor(() =>
      expect(setSelectedModel).toHaveBeenCalledWith(
        "remote/model-1",
        "custom:openai:remote"
      )
    )
  })

  it("puts the full model id in a tooltip on each row", async () => {
    render(<ModelMenu tooltipTextContent="Choose model" />)
    fireEvent.click(screen.getByRole("button", { name: "Choose model" }))
    expect(await screen.findByTitle("gemma-local")).toBeInTheDocument()
  })
})
