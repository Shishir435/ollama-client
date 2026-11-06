import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { SecretKeyField } from "../secret-key-field"

vi.mock("react-i18next", () => {
  const t = (key: string) => key
  return { useTranslation: () => ({ t }) }
})

const setup = (props: Partial<Parameters<typeof SecretKeyField>[0]> = {}) => {
  const handlers = {
    onChange: vi.fn(),
    onRemove: vi.fn(),
    onUndoRemove: vi.fn(),
    onCancelReplace: vi.fn()
  }
  render(<SecretKeyField id="key" stored value="" {...handlers} {...props} />)
  return handlers
}

describe("SecretKeyField", () => {
  it("shows a saved state instead of an empty input when a key is stored", () => {
    setup()
    expect(screen.getByText("settings.secret_key.saved")).toBeTruthy()
    expect(document.getElementById("key")).toBeNull()
  })

  it("removes only on the explicit Remove button", () => {
    const { onRemove } = setup()
    fireEvent.click(screen.getByText("settings.secret_key.remove"))
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it("replaces through an input with a show/hide toggle", () => {
    const { onChange, onCancelReplace } = setup()
    fireEvent.click(screen.getByText("settings.secret_key.replace"))
    const input = document.getElementById("key") as HTMLInputElement
    expect(input.type).toBe("password")
    fireEvent.change(input, { target: { value: "sk-new" } })
    expect(onChange).toHaveBeenCalledWith("sk-new")
    fireEvent.click(screen.getByLabelText("settings.secret_key.show"))
    expect(input.type).toBe("text")
    fireEvent.click(screen.getByText("settings.secret_key.cancel"))
    expect(onCancelReplace).toHaveBeenCalledOnce()
    expect(screen.getByText("settings.secret_key.saved")).toBeTruthy()
  })

  it("offers undo while a removal is pending", () => {
    const { onUndoRemove } = setup({ removePending: true })
    fireEvent.click(screen.getByText("settings.secret_key.undo"))
    expect(onUndoRemove).toHaveBeenCalledOnce()
  })

  it("shows a plain input when nothing is stored", () => {
    setup({ stored: false })
    expect(document.getElementById("key")).toBeTruthy()
  })
})
