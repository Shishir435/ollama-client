import { useStorage } from "@plasmohq/storage/hook"

import {
  DEFAULT_GROUNDED_ONLY_MODE,
  DEFAULT_MAX_RAG_CONTEXT_CHARS,
  DEFAULT_MAX_TAB_CONTEXT_CHARS,
  STORAGE_KEYS
} from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
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
  const [selectedModel] = useStorage<string>(
    {
      key: STORAGE_KEYS.PROVIDER.SELECTED_MODEL,
      instance: plasmoGlobalStorage
    },
    ""
  )
  const [selectedModelRef] = useStorage<SelectedModelRef | null>(
    {
      key: STORAGE_KEYS.PROVIDER.SELECTED_MODEL_REF,
      instance: plasmoGlobalStorage
    },
    null
  )
  const [selectionConflictModel] = useStorage<string | null>(
    {
      key: STORAGE_KEYS.PROVIDER.SELECTION_CONFLICT_MODEL,
      instance: plasmoGlobalStorage
    },
    null
  )
  const [memoryEnabled] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.MEMORY.ENABLED,
      instance: plasmoGlobalStorage
    },
    true
  )
  const [maxTabContextChars] = useStorage<number>(
    {
      key: STORAGE_KEYS.CHAT.MAX_TAB_CONTEXT_CHARS,
      instance: plasmoGlobalStorage
    },
    DEFAULT_MAX_TAB_CONTEXT_CHARS
  )
  const [maxRagContextChars] = useStorage<number>(
    {
      key: STORAGE_KEYS.CHAT.MAX_RAG_CONTEXT_CHARS,
      instance: plasmoGlobalStorage
    },
    DEFAULT_MAX_RAG_CONTEXT_CHARS
  )
  const [groundedOnlyMode] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.CHAT.GROUNDED_ONLY_MODE,
      instance: plasmoGlobalStorage
    },
    DEFAULT_GROUNDED_ONLY_MODE
  )

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
