import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { applyStorageWrites, toast } = vi.hoisted(() => ({
  applyStorageWrites: vi.fn(async (_writes: unknown) => {}),
  toast: vi.fn()
}))
vi.mock("@/features/settings/apply-settings", () => ({ applyStorageWrites }))
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key} ${JSON.stringify(vars)}` : key
  })
}))

import { getSectionDefaults } from "@/lib/constants/section-defaults"
import { PresetPicker } from "../preset-picker"
import { SectionResetButton } from "../section-reset-button"

describe("SectionResetButton", () => {
  beforeEach(() => vi.clearAllMocks())

  it("renders nothing for a section with no defaults", () => {
    const { container } = render(<SectionResetButton sectionId="nope" />)
    expect(container).toBeEmptyDOMElement()
  })

  it("applies the section's defaults on confirm", async () => {
    render(<SectionResetButton sectionId="prompt-budget" />)
    fireEvent.click(screen.getByText("settings.reset_section.button"))
    // The dialog's confirm button shares the label; the action button is last.
    const buttons = screen.getAllByText("settings.reset_section.button")
    fireEvent.click(buttons[buttons.length - 1])
    await waitFor(() => expect(applyStorageWrites).toHaveBeenCalledTimes(1))
    expect(applyStorageWrites).toHaveBeenCalledWith(
      getSectionDefaults("prompt-budget")
    )
  })
})

describe("PresetPicker", () => {
  beforeEach(() => vi.clearAllMocks())

  it("renders all preset labels", () => {
    render(<PresetPicker />)
    expect(screen.getByText("settings.presets.fast.label")).toBeInTheDocument()
    expect(
      screen.getByText("settings.presets.balanced.label")
    ).toBeInTheDocument()
    expect(
      screen.getByText("settings.presets.privacy_strict.label")
    ).toBeInTheDocument()
  })

  it("applies a preset's writes on confirm", async () => {
    render(<PresetPicker />)
    fireEvent.click(screen.getByText("settings.presets.fast.label"))
    fireEvent.click(screen.getByText("settings.presets.apply"))
    await waitFor(() => expect(applyStorageWrites).toHaveBeenCalledTimes(1))
    const writes = applyStorageWrites.mock.calls[0][0] as Array<{
      storageKey: string
    }>
    expect(writes.length).toBeGreaterThan(0)
  })
})
