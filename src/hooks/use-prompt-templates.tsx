import {
  DEFAULT_PROMPT_TEMPLATES,
  STORAGE_KEYS,
  type PromptTemplate
} from "@/lib/constant"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

import { useStorage } from "@plasmohq/storage/hook"

export const usePromptTemplates = () => {
  const [templates, setTemplates] = useStorage<PromptTemplate[]>(
    {
      key: STORAGE_KEYS.OLLAMA.PROMPT_TEMPLATES,
      instance: plasmoGlobalStorage
    },
    DEFAULT_PROMPT_TEMPLATES
  )

  const addTemplate = (template: PromptTemplate) => {
    setTemplates((prev) => [...(prev || []), template])
  }

  const updateTemplate = (id: string, updated: Partial<PromptTemplate>) => {
    setTemplates(
      (prev) => prev?.map((t) => (t.id === id ? { ...t, ...updated } : t)) ?? []
    )
  }

  const deleteTemplate = (id: string) => {
    setTemplates((prev) => prev?.filter((t) => t.id !== id) ?? [])
  }

  return {
    templates,
    addTemplate,
    updateTemplate,
    deleteTemplate
  }
}
