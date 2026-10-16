import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useSetting } from "@/hooks/use-setting"
import { AgentSettings } from "../agent-settings"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock("@/hooks/use-setting", () => ({ useSetting: vi.fn() }))

vi.mock("@/features/model/hooks/use-provider-models", () => ({
  useProviderModels: () => ({ models: [] })
}))

describe("AgentSettings select names", () => {
  beforeEach(() => {
    vi.mocked(useSetting).mockImplementation((() => [
      undefined,
      vi.fn(),
      { isLoading: false }
    ]) as never)
  })

  it("names each select trigger after its visible label", () => {
    render(<AgentSettings />)
    expect(
      screen.getByRole("combobox", {
        name: "agent.settings.permission_mode.label"
      })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("combobox", {
        name: "agent.settings.context_window.label"
      })
    ).toBeInTheDocument()
  })
})
