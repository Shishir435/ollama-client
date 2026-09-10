import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { executeAgentSyntheticDrag } from "../drag-page"
import {
  agentEditorText,
  insertAgentEditableText,
  isAgentEditingHost,
  locateAgentEditorRange,
  placeAgentEditableCaret,
  selectAgentEditableText
} from "../editor-page"
import {
  countAgentTextOccurrences,
  normalizeAgentEditorText,
  replaceAgentTextOnce
} from "../editor-text"

/**
 * The page's half of editing, driven against a document rather than a mock:
 * the editor's flattened text, the range under a run of it, and the fallback
 * insertion a runtime without `execCommand` takes.
 */

beforeEach(() => {
  document.body.replaceChildren()
})

afterEach(() => vi.restoreAllMocks())

const host = (html: string, attributes: Record<string, string> = {}) => {
  const editor = document.createElement("div")
  editor.setAttribute("contenteditable", "true")
  for (const [name, value] of Object.entries(attributes)) {
    editor.setAttribute(name, value)
  }
  editor.innerHTML = html
  document.body.append(editor)
  return editor
}

describe("editor text normalization", () => {
  it("keeps paragraph breaks as single line breaks and drops blank lines and stray spaces", () => {
    expect(normalizeAgentEditorText("  Hello   world \n\n\n Second  ")).toBe(
      "Hello world\nSecond"
    )
    expect(normalizeAgentEditorText("\n\n")).toBe("")
  })

  it("counts exact, non-overlapping occurrences and replaces only a single one", () => {
    expect(countAgentTextOccurrences("aaa", "aa")).toBe(1)
    expect(countAgentTextOccurrences("a b a", "a")).toBe(2)
    expect(countAgentTextOccurrences("abc", "")).toBe(0)
    expect(replaceAgentTextOnce("Hello world", "world", "there")).toBe(
      "Hello there"
    )
    expect(replaceAgentTextOnce("a a", "a", "b")).toBeUndefined()
    expect(replaceAgentTextOnce("abc", "x", "b")).toBeUndefined()
  })
})

describe("editing hosts", () => {
  it("recognizes a host by its own attribute, however true is spelled, and never its children", () => {
    const editor = host("<p>One</p>", { contenteditable: "" })
    expect(isAgentEditingHost(editor)).toBe(true)
    const paragraph = editor.querySelector("p") as Element
    expect(isAgentEditingHost(paragraph)).toBe(false)
    editor.setAttribute("contenteditable", "plaintext-only")
    expect(isAgentEditingHost(editor)).toBe(true)
    editor.setAttribute("contenteditable", "FALSE")
    expect(isAgentEditingHost(editor)).toBe(false)
  })

  it("flattens blocks and line breaks into lines, skipping scripts and trailing break placeholders", () => {
    const editor = host(
      "<p>Hello <b>big</b> world</p><p><br></p><ul><li>one</li><li>two</li></ul><div>a<br>b</div><script>x()</script>"
    )
    expect(agentEditorText(editor)).toBe("Hello big world\none\ntwo\na\nb")
  })

  it("locates a unique run across text nodes and refuses an ambiguous or absent one", () => {
    const editor = host("<p>Hello <b>wor</b>ld</p><p>again</p>")
    const range = locateAgentEditorRange(editor, "world")
    expect(range?.toString()).toBe("world")
    expect(locateAgentEditorRange(editor, "again again")).toBeUndefined()
    const repeated = host("<p>go</p><p>go</p>")
    expect(locateAgentEditorRange(repeated, "go")).toBeUndefined()
  })

  it("matches a run the model read with a line break where the document has a paragraph break", () => {
    const editor = host("<p>first line</p><p>second line</p>")
    expect(
      locateAgentEditorRange(editor, "line\nsecond")?.toString()
    ).toContain("line")
  })
})

describe("editable selection and insertion", () => {
  it("selects a unique run in a text control and refuses a repeated one", () => {
    const input = document.createElement("input")
    input.value = "Hello world"
    document.body.append(input)
    expect(selectAgentEditableText(input, "world")).toBe(true)
    expect(input.selectionStart).toBe(6)
    expect(input.selectionEnd).toBe(11)
    input.value = "go go"
    expect(selectAgentEditableText(input, "go")).toBe(false)
  })

  it("places the caret at the end or over everything in a text control", () => {
    const area = document.createElement("textarea")
    area.value = "abc"
    document.body.append(area)
    placeAgentEditableCaret(area, "end")
    expect([area.selectionStart, area.selectionEnd]).toEqual([3, 3])
    placeAgentEditableCaret(area, "all")
    expect([area.selectionStart, area.selectionEnd]).toEqual([0, 3])
  })

  it("inserts over the selection of a text control and tells the page through an input event", () => {
    const input = document.createElement("input")
    input.value = "Hello world"
    document.body.append(input)
    const seen: string[] = []
    input.addEventListener("input", (event) =>
      seen.push((event as InputEvent).inputType ?? "input")
    )
    selectAgentEditableText(input, "world")
    insertAgentEditableText(input, "there")
    expect(input.value).toBe("Hello there")
    expect(seen).toEqual(["insertText"])
  })

  it("replaces the selected run inside an editing host with a line break per newline, announcing beforeinput and input", () => {
    const editor = host("<p>Hello world</p>")
    const seen: string[] = []
    editor.addEventListener("beforeinput", (event) =>
      seen.push(`before:${(event as InputEvent).inputType}`)
    )
    editor.addEventListener("input", (event) =>
      seen.push(`input:${(event as InputEvent).inputType}`)
    )
    expect(selectAgentEditableText(editor, "world")).toBe(true)
    insertAgentEditableText(editor, "there\nfriend")
    expect(agentEditorText(editor)).toBe("Hello there\nfriend")
    expect(editor.querySelectorAll("br")).toHaveLength(1)
    expect(seen).toEqual(["before:insertText", "input:insertText"])
  })

  it("leaves the document to an editor that cancels beforeinput", () => {
    const editor = host("<p>Hello world</p>")
    editor.addEventListener("beforeinput", (event) => event.preventDefault())
    selectAgentEditableText(editor, "world")
    insertAgentEditableText(editor, "there")
    expect(agentEditorText(editor)).toBe("Hello world")
  })

  it("appends at the end and replaces everything through the caret placement", () => {
    const editor = host("<p>Hello</p>")
    placeAgentEditableCaret(editor, "end")
    insertAgentEditableText(editor, " there")
    expect(agentEditorText(editor)).toBe("Hello there")
    placeAgentEditableCaret(editor, "all")
    insertAgentEditableText(editor, "Fresh")
    expect(agentEditorText(editor)).toBe("Fresh")
    placeAgentEditableCaret(editor, "all")
    insertAgentEditableText(editor, "")
    expect(agentEditorText(editor)).toBe("")
  })
})

describe("synthetic drag", () => {
  const board = () => {
    document.body.innerHTML = `
      <ul id="todo" role="list"><li id="a" draggable="true">Task A</li></ul>
      <ul id="done" role="list"></ul>`
    const item = document.getElementById("a") as HTMLElement
    const done = document.getElementById("done") as HTMLElement
    return { item, done }
  }

  it("carries one DataTransfer from dragstart to drop and drops only where dragover was accepted", () => {
    const { item, done } = board()
    const events: string[] = []
    item.addEventListener("dragstart", (event) => {
      events.push("dragstart")
      ;(event as DragEvent).dataTransfer?.setData("text/plain", "a")
    })
    item.addEventListener("dragend", () => events.push("dragend"))
    done.addEventListener("dragover", (event) => {
      events.push("dragover")
      event.preventDefault()
    })
    done.addEventListener("drop", (event) => {
      events.push(
        `drop:${(event as DragEvent).dataTransfer?.getData("text/plain")}`
      )
      done.append(item)
    })
    const outcome = executeAgentSyntheticDrag({
      source: item,
      destination: done,
      from: { x: 5, y: 5 },
      to: { x: 50, y: 50 }
    })
    expect(outcome.dropped).toBe(true)
    expect(events).toEqual(["dragstart", "dragover", "drop:a", "dragend"])
    expect(done.contains(item)).toBe(true)
  })

  it("sends the pointer sequence for a non-draggable source and no HTML5 events", () => {
    const { item, done } = board()
    item.removeAttribute("draggable")
    const events: string[] = []
    for (const type of ["pointerdown", "mousedown", "dragstart"]) {
      item.addEventListener(type, () => events.push(type))
    }
    for (const type of ["pointermove", "pointerup", "mouseup", "drop"]) {
      done.addEventListener(type, () => events.push(type))
    }
    const outcome = executeAgentSyntheticDrag({
      source: item,
      destination: done,
      from: { x: 5, y: 5 },
      to: { x: 50, y: 50 }
    })
    expect(outcome.dropped).toBe(false)
    expect(events).toEqual([
      "pointerdown",
      "mousedown",
      "pointermove",
      "pointerup",
      "mouseup"
    ])
  })

  it("does not drop on a destination that leaves dragover uncancelled", () => {
    const { item, done } = board()
    const dropped = vi.fn()
    done.addEventListener("drop", dropped)
    const left = vi.fn()
    done.addEventListener("dragleave", left)
    expect(
      executeAgentSyntheticDrag({
        source: item,
        destination: done,
        from: { x: 5, y: 5 },
        to: { x: 50, y: 50 }
      }).dropped
    ).toBe(false)
    expect(dropped).not.toHaveBeenCalled()
    expect(left).toHaveBeenCalledTimes(1)
  })
})
