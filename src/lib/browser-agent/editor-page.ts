import { normalizeAgentEditorText } from "./editor-text"

/**
 * The page's half of editing: what an editing host says, where a run of its
 * text sits, and how a selection is placed and typed over.
 *
 * Everything here drives the browser's own editing pipeline — a selection the
 * editor sees as the user's, `insertText` the editor receives as `beforeinput`
 * and `input` — because a rich-text editor keeps its document in its own
 * model and rebuilds the DOM from it. Writing into the DOM behind its back is
 * how the text appears once and vanishes on the next keystroke.
 */

/** Elements whose start is a line of its own in an editor's flattened text. */
const LINE_BREAKING_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul"
])

/** Content an editor's text never includes, whatever the markup holds. */
const UNREAD_TAGS = new Set(["noscript", "script", "style", "template"])

/**
 * An element that is itself the root of editable content: the attribute is
 * on it and does not say `false`. Read from the attribute rather than
 * `isContentEditable`, which is also true for every descendant of a host and
 * would make each paragraph of a document its own editor.
 */
export const isAgentEditingHost = (element: Element): boolean => {
  const declared = element.getAttribute("contenteditable")
  if (declared === null) return false
  return declared.trim().toLowerCase() !== "false"
}

interface TextSegment {
  node: Text
  /** Where this node's text starts in the raw string. */
  start: number
}

/**
 * The host's text as one raw string — text nodes concatenated, a line break at
 * the start of every block — with the text nodes that produced it. Open shadow
 * roots are walked at their host; closed ones stay unread.
 */
const readEditorText = (
  host: Element
): { raw: string; segments: TextSegment[] } => {
  const segments: TextSegment[] = []
  let raw = ""
  const stack: Node[] = []
  const push = (parent: Node) => {
    const shadow = (parent as Element).shadowRoot
    const children = shadow ? shadow.childNodes : parent.childNodes
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index])
    }
  }
  push(host)
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ""
      if (text.length > 0) {
        segments.push({ node: node as Text, start: raw.length })
        raw += text
      }
      continue
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue
    const tag = (node as Element).tagName.toLowerCase()
    if (UNREAD_TAGS.has(tag)) continue
    if (LINE_BREAKING_TAGS.has(tag)) raw += "\n"
    push(node)
  }
  return { raw, segments }
}

/** What an editing host says, in the shared normalized form. */
export const agentEditorText = (host: Element): string =>
  normalizeAgentEditorText(readEditorText(host).raw)

const escapeRegExp = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * A pattern matching `find` wherever the normalized text would contain it:
 * the tokens in order with any whitespace run between them, since the raw
 * text may hold a paragraph break or a non-breaking space where the model saw
 * one space or one line break.
 */
const findPattern = (find: string): RegExp | undefined => {
  const tokens = find.split(/\s+/).filter((token) => token.length > 0)
  if (tokens.length === 0) return undefined
  return new RegExp(tokens.map(escapeRegExp).join("\\s+"), "g")
}

const positionAt = (
  segments: readonly TextSegment[],
  offset: number,
  endInclusive: boolean
): { node: Text; offset: number } | undefined => {
  for (const segment of segments) {
    const length = segment.node.textContent?.length ?? 0
    const end = segment.start + length
    if (offset < end || (endInclusive && offset === end)) {
      return { node: segment.node, offset: offset - segment.start }
    }
  }
  return undefined
}

/**
 * The DOM range holding the single occurrence of `find` in the host, or
 * nothing when it occurs no times or more than once. Uniqueness is decided
 * here against the live document, not only against the observation the model
 * read, so an edit whose target grew ambiguous since is refused rather than
 * applied to the first match.
 */
export const locateAgentEditorRange = (
  host: Element,
  find: string
): Range | undefined => {
  const pattern = findPattern(find)
  if (!pattern) return undefined
  const { raw, segments } = readEditorText(host)
  const matches = [...raw.matchAll(pattern)]
  if (matches.length !== 1 || matches[0].index === undefined) return undefined
  const start = positionAt(segments, matches[0].index, false)
  const end = positionAt(
    segments,
    matches[0].index + matches[0][0].length,
    true
  )
  if (!start || !end) return undefined
  const range = host.ownerDocument.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  return range
}

const isTextControl = (
  element: Element
): element is HTMLInputElement | HTMLTextAreaElement =>
  element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement

const selectRange = (host: Element, range: Range): boolean => {
  const selection = host.ownerDocument.defaultView?.getSelection?.()
  if (!selection) return false
  selection.removeAllRanges()
  selection.addRange(range)
  return true
}

/**
 * Places the selection over the single occurrence of `find` in an editable
 * control and focuses it, so what is typed next replaces exactly that run.
 * False means the occurrence is not single any more and nothing was placed.
 */
export const selectAgentEditableText = (
  element: Element,
  find: string
): boolean => {
  if (isTextControl(element)) {
    const value = element.value
    const first = value.indexOf(find)
    if (first < 0 || value.indexOf(find, first + find.length) >= 0) {
      return false
    }
    element.focus()
    element.setSelectionRange(first, first + find.length)
    return true
  }
  const range = locateAgentEditorRange(element, find)
  if (!range) return false
  ;(element as HTMLElement).focus?.()
  return selectRange(element, range)
}

/**
 * Focuses an editable control with its caret at the end of its content, or
 * with everything selected, which is where appended and replacing text go.
 */
export const placeAgentEditableCaret = (
  element: Element,
  where: "end" | "all"
): boolean => {
  if (isTextControl(element)) {
    element.focus()
    const length = element.value.length
    element.setSelectionRange(where === "all" ? 0 : length, length)
    return true
  }
  ;(element as HTMLElement).focus?.()
  const range = element.ownerDocument.createRange()
  range.selectNodeContents(element)
  if (where === "end") range.collapse(false)
  return selectRange(element, range)
}

const inputEvent = (
  view: Window | null | undefined,
  type: "beforeinput" | "input",
  inputType: string,
  data: string | null
): Event => {
  const Ctor =
    (view as (Window & typeof globalThis) | null | undefined)?.InputEvent ??
    globalThis.InputEvent
  if (typeof Ctor === "function") {
    return new Ctor(type, {
      bubbles: true,
      cancelable: type === "beforeinput",
      composed: true,
      inputType,
      data
    })
  }
  return new Event(type, { bubbles: true, composed: true })
}

/**
 * The fallback for a runtime without `execCommand`: the selection's contents
 * are replaced in the DOM directly, with a line break element per newline,
 * and the editor is told through the same `beforeinput`/`input` pair the
 * browser would have sent. A `beforeinput` the editor cancels is honoured —
 * the editor has said it will apply the edit to its own model itself.
 */
const insertIntoHostDirectly = (host: Element, text: string): void => {
  const doc = host.ownerDocument
  const selection = doc.defaultView?.getSelection?.()
  const range =
    selection && selection.rangeCount > 0
      ? selection.getRangeAt(0)
      : (() => {
          const whole = doc.createRange()
          whole.selectNodeContents(host)
          whole.collapse(false)
          return whole
        })()
  const inputType = text.length > 0 ? "insertText" : "deleteContentBackward"
  const before = inputEvent(
    doc.defaultView,
    "beforeinput",
    inputType,
    text.length > 0 ? text : null
  )
  if (!host.dispatchEvent(before)) return
  range.deleteContents()
  const lines = text.split(/\r\n|\r|\n/)
  const fragment = doc.createDocumentFragment()
  lines.forEach((line, index) => {
    if (index > 0) fragment.append(doc.createElement("br"))
    if (line.length > 0) fragment.append(doc.createTextNode(line))
  })
  const last = fragment.lastChild
  range.insertNode(fragment)
  if (last && selection) {
    const caret = doc.createRange()
    caret.setStartAfter(last)
    caret.collapse(true)
    selection.removeAllRanges()
    selection.addRange(caret)
  }
  host.dispatchEvent(
    inputEvent(
      doc.defaultView,
      "input",
      inputType,
      text.length > 0 ? text : null
    )
  )
}

/**
 * Types `text` over the current selection of a focused editable control the
 * way the browser's editing pipeline does — `execCommand("insertText")`, or
 * `delete` for an empty replacement — so the editor receives `beforeinput`,
 * mutates its own model and re-renders. Only a runtime without `execCommand`
 * takes the direct path.
 */
export const insertAgentEditableText = (
  element: Element,
  text: string
): void => {
  const doc = element.ownerDocument
  const execCommand = (
    doc as Document & {
      execCommand?: (command: string, ui?: boolean, value?: string) => boolean
    }
  ).execCommand
  if (typeof execCommand === "function") {
    const applied =
      text.length > 0
        ? execCommand.call(doc, "insertText", false, text)
        : execCommand.call(doc, "delete", false)
    if (applied) return
  }
  if (isTextControl(element)) {
    const start = element.selectionStart ?? element.value.length
    const end = element.selectionEnd ?? start
    element.setRangeText(text, start, end, "end")
    element.dispatchEvent(
      inputEvent(
        doc.defaultView,
        "input",
        text.length > 0 ? "insertText" : "deleteContentBackward",
        text.length > 0 ? text : null
      )
    )
    return
  }
  insertIntoHostDirectly(element, text)
}
