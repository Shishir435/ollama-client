import type {
  SelectionActionDefinition,
  SelectionActionId
} from "@/features/selection-actions/types"

export const SELECTION_ACTIONS: SelectionActionDefinition[] = [
  {
    id: "summarize",
    label: "Summarize",
    shortLabel: "Summary",
    instruction:
      "Summarize the selected text concisely. Preserve only facts found in the selection."
  },
  {
    id: "rewrite",
    label: "Rewrite professionally",
    shortLabel: "Rewrite",
    instruction:
      "Rewrite the selected text in a clear professional tone. Preserve meaning and important details."
  },
  {
    id: "shorten",
    label: "Shorten",
    shortLabel: "Shorten",
    instruction:
      "Make the selected text shorter while preserving the main meaning."
  },
  {
    id: "fix-grammar",
    label: "Fix grammar",
    shortLabel: "Grammar",
    instruction:
      "Fix grammar, spelling, and punctuation. Preserve the original meaning and tone."
  },
  {
    id: "explain",
    label: "Explain simply",
    shortLabel: "Explain",
    instruction:
      "Explain the selected text in simple language. Do not add facts that are not supported by the selection."
  },
  {
    id: "action-items",
    label: "Extract action items",
    shortLabel: "Actions",
    instruction:
      "Extract concrete action items from the selected text. Return a concise list only."
  },
  {
    id: "translate-english",
    label: "Translate to English",
    shortLabel: "English",
    instruction:
      "Translate the selected text to English. Preserve formatting meaning, names, and numbers."
  },
  {
    id: "custom",
    label: "Custom prompt",
    shortLabel: "Custom",
    instruction:
      "Follow the user's custom instruction for the selected text. Preserve facts and do not invent details."
  }
]

export const DEFAULT_SELECTION_ACTION_IDS: SelectionActionId[] =
  SELECTION_ACTIONS.map((action) => action.id)

export const getSelectionAction = (
  actionId: SelectionActionId
): SelectionActionDefinition =>
  SELECTION_ACTIONS.find((action) => action.id === actionId) ??
  SELECTION_ACTIONS[0]
