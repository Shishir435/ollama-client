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

export const replaceEditableSelection = (
  target: EditableTarget,
  replacement: string,
  selectionStart = target.selectionStart,
  selectionEnd = target.selectionEnd
): boolean => {
  const start = selectionStart
  const end = selectionEnd
  if (start === null || end === null || start === end) return false

  target.value = `${target.value.slice(0, start)}${replacement}${target.value.slice(end)}`
  const caret = start + replacement.length
  target.setSelectionRange(caret, caret)
  dispatchEditEvents(target)
  return true
}

export const insertAfterEditableSelection = (
  target: EditableTarget,
  insertion: string,
  selectionEnd = target.selectionEnd
): boolean => {
  const end = selectionEnd
  if (end === null) return false

  const text = `\n${insertion}`
  target.value = `${target.value.slice(0, end)}${text}${target.value.slice(end)}`
  const caret = end + text.length
  target.setSelectionRange(caret, caret)
  dispatchEditEvents(target)
  return true
}

export const replaceContentEditableSelection = (
  range: Range,
  root: HTMLElement,
  replacement: string
): boolean => {
  if (!isSingleEditableBlockRange(range, root)) return false
  range.deleteContents()
  range.insertNode(document.createTextNode(replacement))
  range.collapse(false)
  dispatchEditEvents(root)
  return true
}

export const insertAfterContentEditableSelection = (
  range: Range,
  root: HTMLElement,
  insertion: string
): boolean => {
  if (!isSingleEditableBlockRange(range, root)) return false
  range.collapse(false)
  const frag = document.createDocumentFragment()
  frag.appendChild(document.createElement("br"))
  frag.appendChild(document.createTextNode(insertion))
  range.insertNode(frag)
  dispatchEditEvents(root)
  return true
}

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
