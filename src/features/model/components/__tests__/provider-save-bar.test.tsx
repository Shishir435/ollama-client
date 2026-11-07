import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ProviderSaveBar } from "../provider-save-bar"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe("ProviderSaveBar", () => {
  it("renders nothing for a clean, untouched draft", () => {
    const { container } = render(
      <ProviderSaveBar
        dirty={false}
        status="idle"
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("marks a dirty draft and offers Save and Discard", () => {
    const onSave = vi.fn()
    const onDiscard = vi.fn()
    render(
      <ProviderSaveBar
        dirty
        status="idle"
        onSave={onSave}
        onDiscard={onDiscard}
      />
    )

    expect(screen.getByText("settings.providers.unsaved")).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: "settings.providers.save" })
    )
    fireEvent.click(
      screen.getByRole("button", { name: "settings.providers.discard" })
    )
    expect(onSave).toHaveBeenCalled()
    expect(onDiscard).toHaveBeenCalled()
  })

  it("shows an inline Saved status afterwards and no buttons", () => {
    render(
      <ProviderSaveBar
        dirty={false}
        status="saved"
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />
    )
    expect(
      screen.getByText("settings.providers.save_status.saved")
    ).toBeInTheDocument()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("keeps the buttons while a failed save leaves the draft dirty", () => {
    render(
      <ProviderSaveBar
        dirty
        status="failed"
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />
    )
    expect(
      screen.getByRole("button", { name: "settings.providers.save" })
    ).toBeEnabled()
  })
})
