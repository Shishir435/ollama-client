import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { InlineTitleEditor } from "../inline-title-editor"

const setup = (value = "Old title") => {
  const onSave = vi.fn(async () => true)
  const onClose = vi.fn()
  render(
    <InlineTitleEditor
      value={value}
      ariaLabel="Chat title"
      onSave={onSave}
      onClose={onClose}
    />
  )
  return {
    input: screen.getByRole("textbox", { name: "Chat title" }),
    onSave,
    onClose
  }
}

describe("InlineTitleEditor", () => {
  it("saves the trimmed title on Enter, once, and closes", async () => {
    const { input, onSave, onClose } = setup()
    fireEvent.change(input, { target: { value: "  New   name \n" } })
    fireEvent.keyDown(input, { key: "Enter" })
    fireEvent.blur(input)

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith("New name")
  })

  it("restores on Escape without saving, even though the field then blurs", () => {
    const { input, onSave, onClose } = setup()
    fireEvent.change(input, { target: { value: "Changed" } })
    fireEvent.keyDown(input, { key: "Escape" })
    fireEvent.blur(input)

    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("keeps the old title when the new one is empty or unchanged", () => {
    const empty = setup()
    fireEvent.change(empty.input, { target: { value: "   " } })
    fireEvent.keyDown(empty.input, { key: "Enter" })
    expect(empty.onSave).not.toHaveBeenCalled()
    expect(empty.onClose).toHaveBeenCalledTimes(1)
  })

  it("saves when focus leaves the field", async () => {
    const { input, onSave } = setup()
    fireEvent.change(input, { target: { value: "Via blur" } })
    fireEvent.blur(input)
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Via blur"))
  })

  it("does not save while an IME composition is still choosing text", () => {
    const { input, onSave } = setup()
    fireEvent.change(input, { target: { value: "にほん" } })
    fireEvent.keyDown(input, { key: "Enter", isComposing: true })
    expect(onSave).not.toHaveBeenCalled()
  })

  it("caps the field at the title limit", () => {
    const { input } = setup()
    expect(input.getAttribute("maxlength")).toBe("100")
  })
})
