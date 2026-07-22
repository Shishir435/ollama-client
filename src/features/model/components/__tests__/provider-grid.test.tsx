import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { type ProviderConfig, ProviderType } from "@/lib/providers/types"
import { ProviderGrid } from "../provider-grid"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe("ProviderGrid", () => {
  const providers: ProviderConfig[] = [
    {
      id: "ollama",
      name: "Ollama",
      type: ProviderType.OLLAMA,
      enabled: true
    },
    {
      id: "openai",
      name: "OpenAI",
      type: ProviderType.OPENAI,
      enabled: false
    }
  ]

  it("renders provider choices and selects a provider", () => {
    const onSelect = vi.fn()

    render(
      <ProviderGrid
        providers={providers}
        selectedId="ollama"
        providerHealth={{}}
        manualTestStatus={null}
        onSelect={onSelect}
        onAdd={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: /OpenAI/ }))

    expect(screen.getByText("Ollama")).toBeInTheDocument()
    expect(screen.getByText("OpenAI")).toBeInTheDocument()
    expect(onSelect).toHaveBeenCalledWith("openai")
  })

  it("renders an add-provider tile and fires onAdd", () => {
    const onAdd = vi.fn()
    render(
      <ProviderGrid
        providers={providers}
        selectedId="ollama"
        providerHealth={{}}
        manualTestStatus={null}
        onSelect={vi.fn()}
        onAdd={onAdd}
      />
    )

    const addProvider = screen.getByRole("button", {
      name: /settings.providers.add.button/
    })
    expect(
      within(addProvider).getByText("settings.providers.beta_badge")
    ).toBeInTheDocument()
    fireEvent.click(addProvider)
    expect(onAdd).toHaveBeenCalled()
  })

  it("badges custom providers", () => {
    render(
      <ProviderGrid
        providers={[
          ...providers,
          {
            id: "custom:openai:abc123",
            name: "Home box",
            type: ProviderType.OPENAI,
            enabled: true
          }
        ]}
        selectedId="ollama"
        providerHealth={{}}
        manualTestStatus={null}
        onSelect={vi.fn()}
        onAdd={vi.fn()}
      />
    )

    expect(screen.getByText("Home box")).toBeInTheDocument()
    expect(
      screen.getByText("settings.providers.add.custom_badge")
    ).toBeInTheDocument()
    const customProvider = screen.getByRole("button", { name: /Home box/ })
    expect(
      within(customProvider).getByText("settings.providers.beta_badge")
    ).toBeInTheDocument()
  })

  it("lets manual status override selected provider health", () => {
    const { container } = render(
      <ProviderGrid
        providers={providers}
        selectedId="ollama"
        providerHealth={{ ollama: { success: false, lastChecked: 1 } }}
        manualTestStatus={{ success: true, message: "manual ok" }}
        onSelect={vi.fn()}
        onAdd={vi.fn()}
      />
    )

    expect(container.querySelector(".bg-status-success")).toBeInTheDocument()
  })
})
