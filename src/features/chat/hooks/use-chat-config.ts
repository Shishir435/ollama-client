import { useSetting } from "@/hooks/use-setting"
import { SETTINGS } from "@/lib/storage/settings"
import type { SelectedModelRef } from "@/types"

/**
 * Read-only chat-related configuration sourced from `@plasmohq/storage`.
 *
 * Bundled together here so the main `useChat` hook does not have eight
 * separate `useStorage` call sites.
 */
export interface ChatConfig {
  selectedModel: string
  selectedModelRef: SelectedModelRef | null
  selectionConflictModel: string | null
  memoryEnabled: boolean
  maxTabContextChars: number
  maxRagContextChars: number
  groundedOnlyMode: boolean
}

export const useChatConfig = (): ChatConfig => {
  const [selectedModel] = useSetting(SETTINGS.SELECTED_MODEL)
  const [selectedModelRef] = useSetting(SETTINGS.SELECTED_MODEL_REF)
  const [selectionConflictModel] = useSetting(SETTINGS.SELECTION_CONFLICT_MODEL)
  const [memoryEnabled] = useSetting(SETTINGS.MEMORY_ENABLED)
  const [maxTabContextChars] = useSetting(SETTINGS.MAX_TAB_CONTEXT_CHARS)
  const [maxRagContextChars] = useSetting(SETTINGS.MAX_RAG_CONTEXT_CHARS)
  const [groundedOnlyMode] = useSetting(SETTINGS.GROUNDED_ONLY_MODE)

  return {
    selectedModel,
    selectedModelRef,
    selectionConflictModel,
    memoryEnabled,
    maxTabContextChars,
    maxRagContextChars,
    groundedOnlyMode
  }
}
