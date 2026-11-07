import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { type ProviderConfig, ProviderType } from "@/lib/providers/types"
import { ProviderGrid } from "../provider-grid"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock("@/features/model/hooks/use-provider-icons", () => ({
  useProviderIcons: () => ({})
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

    fireEvent.click(screen.getByRole("tab", { name: /OpenAI/ }))

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
      within(addProvider).queryByText("settings.providers.beta_badge")
    ).toBeNull()
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
    const customProvider = screen.getByRole("tab", { name: /Home box/ })
    expect(
      within(customProvider).queryByText("settings.providers.beta_badge")
    ).toBeNull()
  })

  it("lets manual status override selected provider health", () => {
    const { container } = render(
      <ProviderGrid
        providers={providers}
        selectedId="ollama"
        providerHealth={{
          ollama: {
            success: false,
            modelListSupported: true,
            lastChecked: 1
          }
        }}
        manualTestStatus={{ success: true, message: "manual ok" }}
        onSelect={vi.fn()}
        onAdd={vi.fn()}
      />
    )

    expect(
      container.querySelector(".text-status-success-text")
    ).toBeInTheDocument()
  })

  it("marks a catalog-less provider as model IDs only, not connected", () => {
    // Its model count comes from the ids the user declared, and the background
    // check never contacted it. A green dot would claim a round trip nobody
    // made — the settings header already says "model IDs only" here.
    const { container } = render(
      <ProviderGrid
        providers={providers}
        selectedId="openai"
        providerHealth={{
          ollama: {
            success: true,
            modelListSupported: false,
            lastChecked: 1
          }
        }}
        manualTestStatus={null}
        onSelect={vi.fn()}
        onAdd={vi.fn()}
      />
    )

    expect(
      container.querySelector(".text-status-success-text")
    ).not.toBeInTheDocument()
    expect(
      container.querySelector(".text-status-warning-text")
    ).toBeInTheDocument()
  })

  it("keeps an explicit test's verdict for a catalog-less provider", () => {
    // The test reached the chat endpoint, which the background check never
    // does, so it knows something the remembered catalog answer does not.
    const { container } = render(
      <ProviderGrid
        providers={providers}
        selectedId="ollama"
        providerHealth={{
          ollama: {
            success: true,
            modelListSupported: false,
            lastChecked: 1
          }
        }}
        manualTestStatus={{ success: true, message: "manual ok" }}
        onSelect={vi.fn()}
        onAdd={vi.fn()}
      />
    )

    expect(
      container.querySelector(".text-status-success-text")
    ).toBeInTheDocument()
  })

  it("announces the selected tile and its status without relying on color", () => {
    render(
      <ProviderGrid
        providers={providers}
        selectedId="ollama"
        providerHealth={{
          ollama: { success: false } as never
        }}
        manualTestStatus={null}
        onSelect={vi.fn()}
        onAdd={vi.fn()}
      />
    )

    const ollama = screen.getByRole("tab", { name: /Ollama/ })
    const openai = screen.getByRole("tab", { name: /OpenAI/ })
    expect(ollama).toHaveAttribute("aria-selected", "true")
    expect(ollama).toHaveAttribute("aria-controls", "provider-config-panel")
    expect(openai).toHaveAttribute("aria-selected", "false")
    expect(
      within(ollama).getByText("settings.providers.connection_failed")
    ).toHaveClass("sr-only")
    expect(
      within(openai).getByText("settings.providers.status_off")
    ).toHaveClass("sr-only")
  })

  it("shows no beta badge and keeps the custom badge beside a long name", () => {
    render(
      <ProviderGrid
        providers={[
          {
            id: "custom:openai:abc123",
            name: "Ein sehr langer Anbietername für das Heimnetz",
            type: ProviderType.OPENAI,
            enabled: true
          }
        ]}
        selectedId="custom:openai:abc123"
        providerHealth={{}}
        manualTestStatus={null}
        onSelect={vi.fn()}
        onAdd={vi.fn()}
      />
    )

    const tile = screen.getByRole("tab", { name: /Ein sehr langer/ })
    expect(within(tile).queryByText("settings.providers.beta_badge")).toBeNull()
    expect(
      within(tile).getByText("settings.providers.add.custom_badge")
    ).toBeInTheDocument()
    const name = within(tile).getByText(/Ein sehr langer/)
    expect(name).toHaveClass("truncate")
    expect(name).toHaveAttribute(
      "title",
      "Ein sehr langer Anbietername für das Heimnetz"
    )
  })

  it("moves selection between provider tabs with the arrow keys", () => {
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

    fireEvent.keyDown(screen.getByRole("tab", { name: /Ollama/ }), {
      key: "ArrowRight"
    })
    expect(onSelect).toHaveBeenCalledWith("openai")
  })
})
