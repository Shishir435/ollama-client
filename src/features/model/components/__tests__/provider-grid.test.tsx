import { fireEvent, render, screen } from "@testing-library/react"
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
      />
    )

    fireEvent.click(screen.getByRole("button", { name: /OpenAI/ }))

    expect(screen.getByText("Ollama")).toBeInTheDocument()
    expect(screen.getByText("OpenAI")).toBeInTheDocument()
    expect(onSelect).toHaveBeenCalledWith("openai")
  })

  it("lets manual status override selected provider health", () => {
    const { container } = render(
      <ProviderGrid
        providers={providers}
        selectedId="ollama"
        providerHealth={{ ollama: { success: false, lastChecked: 1 } }}
        manualTestStatus={{ success: true, message: "manual ok" }}
        onSelect={vi.fn()}
      />
    )

    expect(container.querySelector(".bg-status-success")).toBeInTheDocument()
  })
})
