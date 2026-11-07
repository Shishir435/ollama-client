import type { SelectionKind, SelectionPayload } from "./types"

const DISALLOWED_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "password",
  "radio",
  "range",
  "reset",
  "submit"
])

const RICH_EDITOR_SELECTOR = [
  "[data-lexical-editor]",
  ".cm-editor",
  ".monaco-editor",
  ".ProseMirror",
  "[data-slate-editor]",
  "[aria-label='Message Body']",
  "[role='textbox'][aria-multiline='true'][g_editable='true']"
].join(",")

export type EditableTarget = HTMLInputElement | HTMLTextAreaElement

export interface SelectionCapture {
  text: string
  rect: DOMRect
  selectionType: SelectionKind
  editableTarget?: EditableTarget
  selectionStart?: number
  selectionEnd?: number
  range?: Range
  contentEditableRoot?: HTMLElement
  canReplace: boolean
  canInsert: boolean
}

export const isEditableInput = (
  element: Element | null
): element is EditableTarget =>
  element instanceof HTMLTextAreaElement ||
  (element instanceof HTMLInputElement &&
    !DISALLOWED_INPUT_TYPES.has(element.type))

const getContentEditableRoot = (
  element: Element | null
): HTMLElement | null => {
  if (!(element instanceof HTMLElement)) return null
  const root = element.closest<HTMLElement>("[contenteditable='true']")
  if (!root) return null
  if (root.closest(RICH_EDITOR_SELECTOR)) return null
  return root
}

export const getRangeRect = (range: Range): DOMRect | null => {
  const rect = range.getBoundingClientRect()
  if (rect.width > 0 || rect.height > 0) return rect

  return (
    Array.from(range.getClientRects()).find(
      (clientRect) => clientRect.width > 0 || clientRect.height > 0
    ) ?? null
  )
}

const isSingleEditableBlockRange = (
  range: Range,
  root: HTMLElement
): boolean => {
  const startElement =
    range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : (range.startContainer as Element | null)
  const endElement =
    range.endContainer.nodeType === Node.TEXT_NODE
      ? range.endContainer.parentElement
      : (range.endContainer as Element | null)

  if (!startElement || !endElement) return false
  if (!root.contains(startElement) || !root.contains(endElement)) return false

  const startBlock = startElement.closest(
    "p,div,li,h1,h2,h3,h4,h5,h6,blockquote,pre"
  )
  const endBlock = endElement.closest(
    "p,div,li,h1,h2,h3,h4,h5,h6,blockquote,pre"
  )

  return !!startBlock && startBlock === endBlock
}

type ComposedSelection = Selection & {
  getComposedRanges?: (options: { shadowRoots: ShadowRoot[] }) => StaticRange[]
}

/** Elements scanned for open shadow roots under a retargeted selection. */
const MAX_SHADOW_SCAN = 500

/**
 * Open shadow roots under the nodes a selection reports. `getRangeAt` retargets
 * a selection inside a shadow tree to its host, so the roots are looked for
 * from there; a closed root cannot be found and stays retargeted.
 */
const openShadowRootsUnder = (nodes: Array<Node | null>): ShadowRoot[] => {
  const roots: ShadowRoot[] = []
  const queue: Element[] = []
  for (const node of nodes) {
    const element =
      node?.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : (node?.parentElement ?? null)
    if (element) queue.push(element)
  }
  let scanned = 0
  while (queue.length > 0 && scanned < MAX_SHADOW_SCAN) {
    const element = queue.shift() as Element
    scanned += 1
    if (element.shadowRoot) {
      roots.push(element.shadowRoot)
      queue.push(...Array.from(element.shadowRoot.children))
    }
    queue.push(...Array.from(element.children))
  }
  return roots
}

/**
 * The selection's range with shadow boundaries kept, where the browser can
 * give one. Text in a web component otherwise anchors the toolbar to the whole
 * host's rectangle. Returns undefined to keep the retargeted range.
 */
const composedSelectionRange = (
  selection: ComposedSelection,
  doc: Document
): Range | undefined => {
  if (typeof selection.getComposedRanges !== "function") return undefined
  const shadowRoots = openShadowRootsUnder([
    selection.anchorNode,
    selection.focusNode
  ])
  if (shadowRoots.length === 0) return undefined
  try {
    const composed = selection.getComposedRanges({ shadowRoots })[0]
    if (!composed) return undefined
    const range = doc.createRange()
    range.setStart(composed.startContainer, composed.startOffset)
    range.setEnd(composed.endContainer, composed.endOffset)
    return range.collapsed ? undefined : range
  } catch {
    return undefined
  }
}

export const getSelectionCapture = (
  doc: Document = document
): SelectionCapture | null => {
  const activeElement = doc.activeElement
  if (isEditableInput(activeElement)) {
    const start = activeElement.selectionStart
    const end = activeElement.selectionEnd

    if (start !== null && end !== null && start !== end) {
      const text = activeElement.value.slice(start, end).trim()
      if (text) {
        return {
          text,
          rect: activeElement.getBoundingClientRect(),
          selectionType:
            activeElement instanceof HTMLTextAreaElement ? "textarea" : "input",
          editableTarget: activeElement,
          selectionStart: start,
          selectionEnd: end,
          canReplace: true,
          canInsert: activeElement instanceof HTMLTextAreaElement
        }
      }
    }
  }

  const selection = doc.defaultView?.getSelection()
  const text = selection?.toString().trim()
  if (!selection || !text || selection.rangeCount === 0) return null

  const retargeted = selection.getRangeAt(selection.rangeCount - 1)
  const composed = composedSelectionRange(selection as ComposedSelection, doc)
  const composedRect = composed ? getRangeRect(composed) : null
  const range = composed && composedRect ? composed : retargeted
  const rect = composedRect ?? getRangeRect(retargeted)
  if (!rect) return null

  const element =
    range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : (range.commonAncestorContainer as Element | null)
  const editableRoot = getContentEditableRoot(element)
  const canEdit =
    !!editableRoot && isSingleEditableBlockRange(range, editableRoot)

  return {
    text,
    rect,
    selectionType: editableRoot ? "contenteditable" : "plain-text",
    range,
    contentEditableRoot: editableRoot ?? undefined,
    canReplace: canEdit,
    canInsert: canEdit
  }
}

export const toSelectionPayload = (
  capture: SelectionCapture,
  doc: Document = document
): SelectionPayload => ({
  selectedText: capture.text,
  pageUrl: doc.location.href,
  pageTitle: doc.title,
  selectionType: capture.selectionType,
  canReplace: capture.canReplace,
  canInsert: capture.canInsert
})

const dispatchEditEvents = (target: EventTarget) => {
  target.dispatchEvent(new InputEvent("input", { bubbles: true }))
  target.dispatchEvent(new Event("change", { bubbles: true }))
}

/**
 * Outcome of writing a result back into the page. `stale` means the text the
 * action ran on is no longer where it was captured, so nothing was written;
 * `undo` puts the prior content back and refuses once the user edited on top.
 */
export type EditOutcome =
  | { applied: true; undo: () => boolean }
  | { applied: false; reason: "stale" | "unsupported" }

const NOT_APPLIED: EditOutcome = { applied: false, reason: "unsupported" }
const STALE: EditOutcome = { applied: false, reason: "stale" }

/**
 * Write a value through the element prototype's setter. React-controlled
 * inputs track their value on the instance, so assigning `.value` directly
 * updates the DOM while React keeps the old value and reverts it on re-render.
 */
const writeNativeValue = (target: EditableTarget, value: string) => {
  const proto =
    target instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
  if (setter) setter.call(target, value)
  else target.value = value
}

/**
 * Where the captured text sits now. The offsets were taken when the user
 * selected, and a result can take seconds to stream, so the field may have
 * changed under them: the original slice wins when it still matches, else the
 * text is looked for once and accepted only when it appears exactly once.
 */
const locateCapturedText = (
  value: string,
  start: number,
  end: number,
  expected: string | undefined
): [number, number] | null => {
  if (expected === undefined) return start <= end ? [start, end] : null
  if (value.slice(start, end).trim() === expected) return [start, end]
  const first = value.indexOf(expected)
  if (first === -1 || first !== value.lastIndexOf(expected)) return null
  return [first, first + expected.length]
}

const writeEditable = (
  target: EditableTarget,
  start: number,
  end: number,
  replacement: string
): EditOutcome => {
  const before = target.value
  const next = `${before.slice(0, start)}${replacement}${before.slice(end)}`
  const caret = start + replacement.length
  let usedNative = false
  try {
    target.focus()
    target.setSelectionRange(start, end)
    usedNative =
      typeof document.execCommand === "function" &&
      document.execCommand("insertText", false, replacement) &&
      target.value === next
  } catch {
    usedNative = false
  }
  if (!usedNative) {
    writeNativeValue(target, next)
    target.setSelectionRange(caret, caret)
    dispatchEditEvents(target)
  }
  const written = target.value
  return {
    applied: true,
    undo: () => {
      if (target.value !== written) return false
      writeNativeValue(target, before)
      target.setSelectionRange(start, end)
      dispatchEditEvents(target)
      return true
    }
  }
}

export const applyEditableReplace = (
  target: EditableTarget,
  replacement: string,
  selectionStart = target.selectionStart,
  selectionEnd = target.selectionEnd,
  expected?: string
): EditOutcome => {
  if (selectionStart === null || selectionEnd === null) return NOT_APPLIED
  if (selectionStart === selectionEnd) return NOT_APPLIED
  const at = locateCapturedText(
    target.value,
    selectionStart,
    selectionEnd,
    expected
  )
  if (!at) return STALE
  return writeEditable(target, at[0], at[1], replacement)
}

export const applyEditableInsert = (
  target: EditableTarget,
  insertion: string,
  selectionEnd = target.selectionEnd,
  expected?: string,
  selectionStart = selectionEnd
): EditOutcome => {
  if (selectionEnd === null || selectionStart === null) return NOT_APPLIED
  const at = locateCapturedText(
    target.value,
    selectionStart,
    selectionEnd,
    expected
  )
  if (!at) return STALE
  return writeEditable(target, at[1], at[1], `\n${insertion}`)
}

export const replaceEditableSelection = (
  target: EditableTarget,
  replacement: string,
  selectionStart = target.selectionStart,
  selectionEnd = target.selectionEnd
): boolean =>
  applyEditableReplace(target, replacement, selectionStart, selectionEnd)
    .applied

export const insertAfterEditableSelection = (
  target: EditableTarget,
  insertion: string,
  selectionEnd = target.selectionEnd
): boolean => applyEditableInsert(target, insertion, selectionEnd).applied

/**
 * The captured range, or where its text is now. A live range follows edits
 * made through the DOM, but a framework re-render replaces nodes and leaves it
 * collapsed or detached; the text is then looked for in the root's own text
 * nodes and accepted only when exactly one holds it.
 */
const resolveContentEditableRange = (
  range: Range,
  root: HTMLElement,
  expected: string | undefined
): Range | null => {
  const intact =
    root.contains(range.commonAncestorContainer) &&
    isSingleEditableBlockRange(range, root)
  if (
    intact &&
    (expected === undefined || range.toString().trim() === expected)
  )
    return range
  if (!expected) return null
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const hits: Array<[Text, number]> = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text
    const first = text.data.indexOf(expected)
    if (first === -1) continue
    if (first !== text.data.lastIndexOf(expected)) return null
    hits.push([text, first])
  }
  if (hits.length !== 1) return null
  const [text, offset] = hits[0]
  const found = root.ownerDocument.createRange()
  found.setStart(text, offset)
  found.setEnd(text, offset + expected.length)
  return found
}

const placeSelection = (range: Range) => {
  const selection =
    range.commonAncestorContainer.ownerDocument?.defaultView?.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

/**
 * Edit a contenteditable through `execCommand` where the browser has it, so
 * the page's own undo stack and its editor's input handlers see an ordinary
 * edit. Falls back to a DOM edit, whose undo restores a snapshot of the block.
 */
const writeContentEditable = (
  range: Range,
  root: HTMLElement,
  commands: Array<[string, string | undefined]>,
  fallback: () => void
): EditOutcome => {
  const snapshot = root.innerHTML
  let native = false
  try {
    root.focus()
    placeSelection(range)
    native =
      typeof document.execCommand === "function" &&
      commands.every(([name, value]) =>
        document.execCommand(name, false, value)
      ) &&
      root.innerHTML !== snapshot
  } catch {
    native = false
  }
  if (!native) {
    if (root.innerHTML !== snapshot) root.innerHTML = snapshot
    fallback()
    dispatchEditEvents(root)
  }
  const written = root.innerHTML
  return {
    applied: true,
    undo: () => {
      if (root.innerHTML !== written) return false
      root.innerHTML = snapshot
      dispatchEditEvents(root)
      return true
    }
  }
}

export const applyContentEditableReplace = (
  range: Range,
  root: HTMLElement,
  replacement: string,
  expected?: string
): EditOutcome => {
  const target = resolveContentEditableRange(range, root, expected)
  if (!target) return expected ? STALE : NOT_APPLIED
  return writeContentEditable(
    target,
    root,
    [["insertText", replacement]],
    () => {
      target.deleteContents()
      target.insertNode(document.createTextNode(replacement))
    }
  )
}

export const applyContentEditableInsert = (
  range: Range,
  root: HTMLElement,
  insertion: string,
  expected?: string
): EditOutcome => {
  const resolved = resolveContentEditableRange(range, root, expected)
  if (!resolved) return expected ? STALE : NOT_APPLIED
  const target = resolved.cloneRange()
  target.collapse(false)
  return writeContentEditable(
    target,
    root,
    [
      ["insertLineBreak", undefined],
      ["insertText", insertion]
    ],
    () => {
      const frag = document.createDocumentFragment()
      frag.appendChild(document.createElement("br"))
      frag.appendChild(document.createTextNode(insertion))
      target.insertNode(frag)
    }
  )
}

export const replaceContentEditableSelection = (
  range: Range,
  root: HTMLElement,
  replacement: string
): boolean => applyContentEditableReplace(range, root, replacement).applied

export const insertAfterContentEditableSelection = (
  range: Range,
  root: HTMLElement,
  insertion: string
): boolean => applyContentEditableInsert(range, root, insertion).applied

/**
 * Put focus back where the user was reading when the overlay closes.
 *
 * A selection made with the mouse leaves focus on `<body>`, so there is no
 * control to return to, and closing the panel from the keyboard dropped focus
 * there: the next Tab started from the top of the page. The element holding
 * the selection takes a temporary `tabindex="-1"`, which lets it hold focus
 * without joining the tab order, and gives it back on blur. An element that
 * already declares a tabindex keeps its own. The selection is left alone:
 * re-adding it would fire `selectionchange` and bring the toolbar back.
 */
export const focusSelectionAnchor = (range: Range | undefined): boolean => {
  if (!range) return false
  const node = range.commonAncestorContainer
  const element =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  if (!(element instanceof HTMLElement) || !element.isConnected) return false
  if (!element.hasAttribute("tabindex")) {
    element.setAttribute("tabindex", "-1")
    element.addEventListener(
      "blur",
      () => element.removeAttribute("tabindex"),
      { once: true }
    )
  }
  element.focus({ preventScroll: true })
  return element.ownerDocument.activeElement === element
}

/**
 * The control to hand focus back to when the overlay closes: the field the
 * text was selected in, else whatever held focus. `<body>` is not a control —
 * "returning" to it is how focus got lost — so it counts as none, and the
 * caller falls back to the selection's own element.
 */
export const pickReturnFocusTarget = (
  capture: Pick<SelectionCapture, "editableTarget">,
  active: Element | null,
  overlayHost: Element | null
): HTMLElement | null =>
  capture.editableTarget ??
  (active instanceof HTMLElement &&
  active !== overlayHost &&
  active !== active.ownerDocument.body
    ? active
    : null)
