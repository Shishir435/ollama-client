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

  const range = selection.getRangeAt(selection.rangeCount - 1)
  const rect = getRangeRect(range)
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
