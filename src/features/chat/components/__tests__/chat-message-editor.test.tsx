import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ChatMessageEditor } from "@/features/chat/components/chat-message-editor"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe("ChatMessageEditor", () => {
  it("saves on Enter", () => {
    const onSave = vi.fn()
    render(
      <ChatMessageEditor
        initialContent="hello"
        onSave={onSave}
        onCancel={vi.fn()}
      />
    )
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" })
    expect(onSave).toHaveBeenCalledWith("hello")
  })

  it("does not save on the Enter that commits an IME candidate", () => {
    const onSave = vi.fn()
    render(
      <ChatMessageEditor
        initialContent="hello"
        onSave={onSave}
        onCancel={vi.fn()}
      />
    )
    const field = screen.getByRole("textbox")
    fireEvent.keyDown(field, { key: "Enter", keyCode: 229 })
    fireEvent.keyDown(field, { key: "Enter", isComposing: true })
    expect(onSave).not.toHaveBeenCalled()
  })
})
