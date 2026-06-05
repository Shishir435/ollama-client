import { describe, expect, it, vi } from "vitest"
import {
  getRangeRect,
  getSelectionCapture,
  insertAfterContentEditableSelection,
  insertAfterEditableSelection,
  isEditableInput,
  replaceContentEditableSelection,
  replaceEditableSelection,
  toSelectionPayload
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

  it("replaceEditableSelection returns false when selection start equals end", () => {
    const input = document.createElement("input")
    input.value = "hello"
    input.setSelectionRange(3, 3)
    expect(replaceEditableSelection(input, "x")).toBe(false)
    expect(input.value).toBe("hello")
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

  it("returns null getSelectionCapture when nothing selected", () => {
    expect(getSelectionCapture(document)).toBeNull()
  })

  it("returns null getSelectionCapture for empty textarea selection (cursor only)", () => {
    const textarea = document.createElement("textarea")
    textarea.value = "hello"
    document.body.append(textarea)
    textarea.focus()
    textarea.setSelectionRange(2, 2)

    expect(getSelectionCapture(document)).toBeNull()
    textarea.remove()
  })

  it("maps SelectionCapture to SelectionPayload via toSelectionPayload", () => {
    const textarea = document.createElement("textarea")
    textarea.value = "pick me"
    document.body.append(textarea)
    textarea.focus()
    textarea.setSelectionRange(0, 7)

    const capture = getSelectionCapture(document)
    expect(capture).not.toBeNull()
    if (!capture) return

    const mockDoc = {
      location: { href: "https://example.com/page" },
      title: "Test Page"
    } as unknown as Document

    const payload = toSelectionPayload(capture, mockDoc)
    expect(payload.selectedText).toBe("pick me")
    expect(payload.pageUrl).toBe("https://example.com/page")
    expect(payload.pageTitle).toBe("Test Page")
    expect(payload.selectionType).toBe("textarea")
    expect(payload.canReplace).toBe(true)
    expect(payload.canInsert).toBe(true)

    textarea.remove()
  })

  it("isEditableInput accepts textarea and text input", () => {
    const textarea = document.createElement("textarea")
    const textInput = document.createElement("input")
    textInput.type = "text"
    expect(isEditableInput(textarea)).toBe(true)
    expect(isEditableInput(textInput)).toBe(true)
  })

  it("isEditableInput rejects button, checkbox, file, password, submit inputs", () => {
    for (const type of ["button", "checkbox", "file", "password", "submit"]) {
      const input = document.createElement("input")
      input.type = type
      expect(isEditableInput(input), `type=${type}`).toBe(false)
    }
    expect(isEditableInput(null)).toBe(false)
    expect(isEditableInput(document.createElement("div"))).toBe(false)
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

  it("rejects multi-block contenteditable range for replace", () => {
    const editor = document.createElement("div")
    editor.contentEditable = "true"
    editor.innerHTML = "<p>First para</p><p>Second para</p>"
    document.body.append(editor)

    const [p1, p2] = editor.querySelectorAll("p")
    const range = document.createRange()
    range.setStart(p1.firstChild as Text, 0)
    range.setEnd(p2.firstChild as Text, 6)

    expect(replaceContentEditableSelection(range, editor, "nope")).toBe(false)
    editor.remove()
  })

  it("inserts text after contenteditable selection with a <br> line break", () => {
    const editor = document.createElement("div")
    editor.contentEditable = "true"
    editor.innerHTML = "<p>Hello world</p>"
    document.body.append(editor)

    const textNode = editor.querySelector("p")?.firstChild as Text
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 5)

    expect(insertAfterContentEditableSelection(range, editor, "inserted")).toBe(
      true
    )
    const p = editor.querySelector("p")
    expect(p).not.toBeNull()
    if (!p) return
    const br = p.querySelector("br")
    expect(br).not.toBeNull()
    const textAfterBr = br?.nextSibling as Text
    expect(textAfterBr?.nodeType).toBe(Node.TEXT_NODE)
    expect(textAfterBr?.textContent).toBe("inserted")

    editor.remove()
  })

  it("rejects multi-block range in insertAfterContentEditableSelection", () => {
    const editor = document.createElement("div")
    editor.contentEditable = "true"
    editor.innerHTML = "<p>First</p><p>Second</p>"
    document.body.append(editor)

    const [p1, p2] = editor.querySelectorAll("p")
    const range = document.createRange()
    range.setStart(p1.firstChild as Text, 0)
    range.setEnd(p2.firstChild as Text, 3)

    expect(insertAfterContentEditableSelection(range, editor, "x")).toBe(false)
    editor.remove()
  })

  it("getRangeRect falls back to getClientRects when getBoundingClientRect is zero", () => {
    const div = document.createElement("div")
    div.textContent = "test"
    document.body.append(div)

    const range = document.createRange()
    range.selectNodeContents(div)

    vi.spyOn(range, "getBoundingClientRect").mockReturnValue({
      width: 0,
      height: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({})
    } as DOMRect)
    vi.spyOn(range, "getClientRects").mockReturnValue([
      {
        width: 50,
        height: 20,
        top: 10,
        left: 5,
        right: 55,
        bottom: 30,
        x: 5,
        y: 10,
        toJSON: () => ({})
      }
    ] as unknown as DOMRectList)

    const rect = getRangeRect(range)
    expect(rect).not.toBeNull()
    expect(rect?.width).toBe(50)

    div.remove()
  })

  it("getRangeRect returns null when all rects are zero", () => {
    const div = document.createElement("div")
    document.body.append(div)

    const range = document.createRange()
    range.selectNodeContents(div)

    vi.spyOn(range, "getBoundingClientRect").mockReturnValue({
      width: 0,
      height: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({})
    } as DOMRect)
    vi.spyOn(range, "getClientRects").mockReturnValue(
      [] as unknown as DOMRectList
    )

    expect(getRangeRect(range)).toBeNull()
    div.remove()
  })
})
