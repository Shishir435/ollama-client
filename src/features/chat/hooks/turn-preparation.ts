import type { TurnToast } from "@/application/turns/turn-contract"
import type { ProcessedFile } from "@/lib/file-processors/types"
import type {
  ChatMessage,
  FileAttachment,
  ImageAttachment,
  SelectedModelRef
} from "@/types"

/**
 * A toast this module decided to show, named by translation key rather than
 * text: this is a pure module with no `t`, and the copy is user-visible, so the
 * caller resolves it. Values are interpolation arguments for the description.
 */
export type { TurnToast } from "@/application/turns/turn-contract"

/**
 * Pure pre-send gate. The turn controller (and, later, the agent loop) share
 * these guards, so they live here as a single testable verdict rather than a
 * ladder of inline early returns. A `false` verdict without a toast is a silent
 * no-op (stream busy, or nothing to send); a toast means tell the user why.
 */
export type PreconditionVerdict =
  | { proceed: true }
  | { proceed: false; toast?: TurnToast }

export const evaluateSendPreconditions = (input: {
  isBusy: boolean
  selectionConflictModel: string | null | undefined
  rawInput: string
  hasFiles: boolean
  hasImages: boolean
  resolvedModel: string | undefined
}): PreconditionVerdict => {
  if (input.isBusy) return { proceed: false }

  if (input.selectionConflictModel) {
    return {
      proceed: false,
      toast: {
        variant: "destructive",
        titleKey: "chat.errors.provider_selection_required_title",
        descriptionKey: "chat.errors.provider_selection_required_description",
        descriptionValues: { model: input.selectionConflictModel }
      }
    }
  }

  if (!input.rawInput && !input.hasFiles && !input.hasImages) {
    return { proceed: false }
  }

  // A resolvable model is required before we flip into the loading state:
  // generateResponse bails silently with none, stranding the turn at
  // "Preparing context..." forever.
  if (!input.resolvedModel) {
    return {
      proceed: false,
      toast: {
        variant: "destructive",
        titleKey: "chat.errors.no_model_selected_title",
        descriptionKey: "chat.errors.no_model_selected_description"
      }
    }
  }

  return { proceed: true }
}

/**
 * Resolve the effective model for a turn: an explicit per-send override wins,
 * then the mapped provider model, then the plain selected-model string. Shared
 * so precondition gating and assistant-notice authoring never diverge.
 */
export const resolveTurnModel = (
  customModel: string | undefined,
  selectedModelRef: SelectedModelRef | null,
  selectedModel: string
): string => customModel || selectedModelRef?.modelId || selectedModel

const buildFileAttachments = (
  files: ProcessedFile[] | undefined
): FileAttachment[] | undefined =>
  files && files.length > 0
    ? files.map((file) => ({
        fileId: file.metadata.fileId || `file-${Date.now()}-${Math.random()}`,
        fileName: file.metadata.fileName,
        fileType: file.metadata.fileType,
        fileSize: file.metadata.fileSize,
        textPreview: file.text.slice(0, 200),
        processedAt: file.metadata.processedAt
      }))
    : undefined

export const buildUserMessage = (input: {
  content: string
  files: ProcessedFile[] | undefined
  images: ImageAttachment[] | undefined
}): ChatMessage => ({
  role: "user",
  content: input.content,
  attachments: buildFileAttachments(input.files),
  images: input.images && input.images.length > 0 ? input.images : undefined
})
