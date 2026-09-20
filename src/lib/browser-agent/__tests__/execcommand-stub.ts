/**
 * A test stand-in for the browser's `document.execCommand`, which happy-dom
 * does not implement.
 *
 * Production edits an editing host only through `execCommand`, never by
 * writing its DOM, so a real browser (Chrome via the debugger, Firefox via
 * `execCommand`) owns the mutation. This reproduces what that command does to
 * a `contenteditable` — delete the selection, insert the text with a `<br>`
 * per newline, collapse the caret, and fire `beforeinput`/`input` — so a unit
 * test can drive the same code path a browser would. A cancelled `beforeinput`
 * leaves the DOM untouched, as the platform does.
 */
export const installAgentExecCommandStub = (doc: Document): void => {
  const view = doc.defaultView as
    | (Window & typeof globalThis)
    | null
    | undefined
  const fire = (
    target: Element,
    type: "beforeinput" | "input",
    inputType: string,
    data: string | null
  ): boolean => {
    const Ctor = view?.InputEvent ?? globalThis.InputEvent
    const event =
      typeof Ctor === "function"
        ? new Ctor(type, {
            bubbles: true,
            cancelable: type === "beforeinput",
            composed: true,
            inputType,
            data
          })
        : new Event(type, { bubbles: true, cancelable: type === "beforeinput" })
    return target.dispatchEvent(event)
  }
  ;(
    doc as Document & {
      execCommand?: (command: string, ui?: boolean, value?: string) => boolean
    }
  ).execCommand = (command, _ui, value) => {
    const insert = command === "insertText"
    const text = insert ? (value ?? "") : ""
    const selection = view?.getSelection?.()
    if (!selection || selection.rangeCount === 0) return false
    const range = selection.getRangeAt(0)
    const start = range.startContainer
    const anchor =
      start.nodeType === 1
        ? (start as Element)
        : (start.parentElement ?? doc.body)
    const inputType =
      insert && text.length > 0 ? "insertText" : "deleteContentBackward"
    if (!fire(anchor, "beforeinput", inputType, insert ? text : null)) {
      return true
    }
    range.deleteContents()
    if (insert && text.length > 0) {
      const fragment = doc.createDocumentFragment()
      text.split(/\r\n|\r|\n/).forEach((line, index) => {
        if (index > 0) fragment.append(doc.createElement("br"))
        if (line.length > 0) fragment.append(doc.createTextNode(line))
      })
      const last = fragment.lastChild
      range.insertNode(fragment)
      if (last) {
        const caret = doc.createRange()
        caret.setStartAfter(last)
        caret.collapse(true)
        selection.removeAllRanges()
        selection.addRange(caret)
      }
    }
    fire(anchor, "input", inputType, insert ? text : null)
    return true
  }
}
