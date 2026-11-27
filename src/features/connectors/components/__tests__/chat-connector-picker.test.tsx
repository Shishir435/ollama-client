import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const selection = vi.hoisted(() => ({
  connectors: [] as Array<{ id: string; name: string }>,
  off: new Set<string>(),
  toggle: vi.fn()
}))
vi.mock("../../hooks/use-chat-connector-selection", () => ({
  useChatConnectorSelection: () => ({
    connectors: selection.connectors,
    isEnabledForChat: (id: string) => !selection.off.has(id),
    toggle: selection.toggle
  })
}))

import { ChatConnectorPicker } from "../chat-connector-picker"

describe("ChatConnectorPicker", () => {
  it("renders nothing while no connector is enabled", () => {
    selection.connectors = []
    const { container } = render(<ChatConnectorPicker />)
    expect(container).toBeEmptyDOMElement()
  })

  it("shows each connector's state and toggles the one clicked", () => {
    selection.connectors = [
      { id: "mail", name: "Mail" },
      { id: "notes", name: "Notes" }
    ]
    selection.off = new Set(["notes"])
    render(<ChatConnectorPicker />)

    expect(
      screen.getByRole("button", { name: "Mail" }).getAttribute("aria-pressed")
    ).toBe("true")
    const notes = screen.getByRole("button", { name: "Notes" })
    expect(notes.getAttribute("aria-pressed")).toBe("false")

    fireEvent.click(notes)
    expect(selection.toggle).toHaveBeenCalledWith("notes")
  })
})
