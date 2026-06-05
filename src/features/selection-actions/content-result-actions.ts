import {
  insertAfterContentEditableSelection,
  insertAfterEditableSelection,
  replaceContentEditableSelection,
  replaceEditableSelection,
  type SelectionCapture
} from "@/features/selection-actions/dom"
import { MESSAGE_KEYS } from "@/lib/constants"

export async function openSelectionResultInChat(
  resultText: string,
  capture: SelectionCapture | null
) {
  const text = resultText.trim() || capture?.text.trim()
  if (!text) return false

  await chrome.runtime.sendMessage({
    type: MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT,
    payload: text
  })
  window.getSelection()?.removeAllRanges()
  return true
}

export async function copySelectionResult(resultText: string) {
  const text = resultText.trim()
  if (!text) return false

  await navigator.clipboard.writeText(text)
  return true
}

export function replaceCapturedSelection(
  capture: SelectionCapture | null,
  resultText: string
) {
  const text = resultText.trim()
  if (!capture || !text) return false

  if (capture.editableTarget) {
    capture.editableTarget.focus()
    return replaceEditableSelection(
      capture.editableTarget,
      text,
      capture.selectionStart,
      capture.selectionEnd
    )
  }

  if (capture.range && capture.contentEditableRoot) {
    return replaceContentEditableSelection(
      capture.range,
      capture.contentEditableRoot,
      text
    )
  }

  return false
}

export function insertBelowCapturedSelection(
  capture: SelectionCapture | null,
  resultText: string
) {
  const text = resultText.trim()
  if (!capture || !text) return false

  if (capture.editableTarget) {
    capture.editableTarget.focus()
    return insertAfterEditableSelection(
      capture.editableTarget,
      text,
      capture.selectionEnd
    )
  }

  if (capture.range && capture.contentEditableRoot) {
    return insertAfterContentEditableSelection(
      capture.range,
      capture.contentEditableRoot,
      text
    )
  }

  return false
}
