import {
  applyContentEditableInsert,
  applyContentEditableReplace,
  applyEditableInsert,
  applyEditableReplace,
  type EditOutcome,
  type SelectionCapture
} from "@/features/selection-actions/dom"
import { MESSAGE_KEYS } from "@/lib/constants"
import { sendRuntimeMessage } from "@/lib/retained-runtime-messages"

export async function openSelectionResultInChat(
  resultText: string,
  capture: SelectionCapture | null
) {
  const result = resultText.trim()
  if (!result) return false

  const parts: string[] = []
  if (capture?.text.trim()) {
    parts.push(capture.text.trim())
    parts.push("---")
  }
  parts.push(result)

  await sendRuntimeMessage(MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT, {
    payload: parts.join("\n\n")
  })
  window.getSelection()?.removeAllRanges()
  return true
}

export async function copySelectionResult(resultText: string) {
  const text = resultText.trim()
  if (!text) return false

  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Pages can deny clipboard access (permissions policy, lost focus).
    return false
  }
}

/**
 * Write the result over the captured selection, re-checking first that the
 * captured text is still there. Callers keep `undo` to offer one step back.
 */
export function replaceCapturedSelection(
  capture: SelectionCapture | null,
  resultText: string
): EditOutcome {
  const text = resultText.trim()
  if (!capture || !text) return { applied: false, reason: "unsupported" }

  if (capture.editableTarget) {
    return applyEditableReplace(
      capture.editableTarget,
      text,
      capture.selectionStart,
      capture.selectionEnd,
      capture.text
    )
  }

  if (capture.range && capture.contentEditableRoot) {
    return applyContentEditableReplace(
      capture.range,
      capture.contentEditableRoot,
      text,
      capture.text
    )
  }

  return { applied: false, reason: "unsupported" }
}

export function insertBelowCapturedSelection(
  capture: SelectionCapture | null,
  resultText: string
): EditOutcome {
  const text = resultText.trim()
  if (!capture || !text) return { applied: false, reason: "unsupported" }

  if (capture.editableTarget) {
    return applyEditableInsert(
      capture.editableTarget,
      text,
      capture.selectionEnd,
      capture.text,
      capture.selectionStart
    )
  }

  if (capture.range && capture.contentEditableRoot) {
    return applyContentEditableInsert(
      capture.range,
      capture.contentEditableRoot,
      text,
      capture.text
    )
  }

  return { applied: false, reason: "unsupported" }
}
