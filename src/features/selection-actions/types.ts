import type { ChatMessage } from "@/types"

export type SelectionActionId =
  | "summarize"
  | "rewrite"
  | "shorten"
  | "fix-grammar"
  | "explain"
  | "action-items"
  | "translate-english"
  | "custom"

export type SelectionKind =
  | "plain-text"
  | "input"
  | "textarea"
  | "contenteditable"
  | "unknown"

export interface SelectionPayload {
  selectedText: string
  pageUrl: string
  pageTitle: string
  selectionType: SelectionKind
  canReplace: boolean
  canInsert: boolean
  surroundingText?: string
}

export interface SelectionActionDefinition {
  id: SelectionActionId
  label: string
  shortLabel: string
  instruction: string
}

export interface SelectionActionRequest {
  actionId: SelectionActionId
  selection: SelectionPayload
  customInstruction?: string
  model?: string
  providerId?: string
}

export interface SelectionActionMessage {
  type: string
  payload: SelectionActionRequest
}

export interface SelectionActionPrompt {
  messages: ChatMessage[]
}
