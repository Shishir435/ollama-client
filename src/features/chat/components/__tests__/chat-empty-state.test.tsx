import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ChatEmptyState } from "../chat-empty-state"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock("@/features/model/components/provider-settings", () => ({
  ProviderSettings: () => null
}))
vi.mock("@/lib/browser-api", () => ({ openExternalUrl: vi.fn() }))

const providerModels = vi.hoisted(() => ({
  value: { status: "ready", refresh: vi.fn(), ollamaEnabled: true } as Record<
    string,
    unknown
  >
}))
vi.mock("@/features/model/hooks/use-provider-models", () => ({
  useProviderModels: () => providerModels.value
}))

describe("ChatEmptyState", () => {
  beforeEach(() => {
    providerModels.value = {
      status: "ready",
      refresh: vi.fn(),
      ollamaEnabled: true
    }
  })

  it("names the product and shows no status once a provider answers", () => {
    render(<ChatEmptyState />)
    expect(screen.getByRole("heading", { name: "welcome.title" })).toBeTruthy()
    expect(screen.getByText("welcome.subtitle")).toBeTruthy()
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("says nothing while connecting", () => {
    providerModels.value = { ...providerModels.value, status: "loading" }
    render(<ChatEmptyState />)
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("keeps the blocker through a background poll", () => {
    providerModels.value = { ...providerModels.value, status: "error" }
    const { rerender } = render(<ChatEmptyState />)
    providerModels.value = { ...providerModels.value, status: "loading" }
    rerender(<ChatEmptyState />)
    expect(screen.getByRole("status")).toBeTruthy()
  })

  it("shows the blocker with retry, setup and the guide when no provider answers", () => {
    providerModels.value = { ...providerModels.value, status: "error" }
    render(<ChatEmptyState />)
    expect(screen.getByRole("status")).toBeTruthy()
    expect(screen.getByText("common.actions.retry")).toBeTruthy()
    expect(screen.getByText("onboarding.provider.open_setup")).toBeTruthy()
    expect(screen.getByText(/welcome.setup_guide.full_guide_link/)).toBeTruthy()
  })
})
