import { describe, expect, it, vi } from "vitest"
import {
  getSelectionCapture,
  insertAfterEditableSelection,
  replaceContentEditableSelection,
  replaceEditableSelection
} from "../dom"

describe("selection action DOM helpers", () => {
  it("replaces textarea selection and dispatches edit events", () => {
    const textarea = document.createElement("textarea")
    textarea.value = "hello rough world"
    textarea.setSelectionRange(6, 11)

    const inputListener = vi.fn()
    const changeListener = vi.fn()
    textarea.addEventListener("input", inputListener)
    textarea.addEventListener("change", changeListener)

    expect(replaceEditableSelection(textarea, "clean")).toBe(true)
    expect(textarea.value).toBe("hello clean world")
    expect(textarea.selectionStart).toBe(11)
    expect(inputListener).toHaveBeenCalledOnce()
    expect(changeListener).toHaveBeenCalledOnce()
  })

  it("inserts below textarea selection without replacing text", () => {
    const input = document.createElement("textarea")
    input.value = "first line"
    input.setSelectionRange(5, 5)

    expect(insertAfterEditableSelection(input, "second line")).toBe(true)
    expect(input.value).toBe("first\nsecond line line")
  })

  it("allows replace but hides insert for single-line input selection", () => {
    const input = document.createElement("input")
    input.value = "hello rough world"
    document.body.append(input)
    input.focus()
    input.setSelectionRange(6, 11)

    const capture = getSelectionCapture(document)

    expect(capture?.selectionType).toBe("input")
    expect(capture?.canReplace).toBe(true)
    expect(capture?.canInsert).toBe(false)

    input.remove()
  })

  it("allows replace and insert for textarea selection", () => {
    const textarea = document.createElement("textarea")
    textarea.value = "hello rough world"
    document.body.append(textarea)
    textarea.focus()
    textarea.setSelectionRange(6, 11)

    const capture = getSelectionCapture(document)

    expect(capture?.selectionType).toBe("textarea")
    expect(capture?.canReplace).toBe(true)
    expect(capture?.canInsert).toBe(true)

    textarea.remove()
  })

  it("preserves heading element when replacing contenteditable text", () => {
    const editor = document.createElement("div")
    editor.contentEditable = "true"
    editor.innerHTML = "<h2>Old heading</h2>"
    document.body.append(editor)

    const heading = editor.querySelector("h2")
    const textNode = heading?.firstChild
    expect(heading).toBeTruthy()
    expect(textNode).toBeTruthy()

    const range = document.createRange()
    range.setStart(textNode as Text, 0)
    range.setEnd(textNode as Text, "Old heading".length)

    expect(replaceContentEditableSelection(range, editor, "New heading")).toBe(
      true
    )
    expect(editor.querySelector("h2")?.textContent).toBe("New heading")
    expect(editor.querySelector("h2")).toBe(heading)

    editor.remove()
  })
})
