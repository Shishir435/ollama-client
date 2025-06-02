import { useCallback } from "react"

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

  const effectiveTemplates =
    templates && templates.length > 0 ? templates : DEFAULT_PROMPT_TEMPLATES

  const addTemplate = useCallback(
    (template: Omit<PromptTemplate, "createdAt" | "usageCount">) => {
      const newTemplate: PromptTemplate = {
        ...template,
        createdAt: new Date(),
        usageCount: 0
      }
      setTemplates((prev) => [...(prev || []), newTemplate])
    },
    [setTemplates]
  )

  const updateTemplate = useCallback(
    (id: string, updated: Partial<PromptTemplate>) => {
      setTemplates(
        (prev) =>
          prev?.map((t) => (t.id === id ? { ...t, ...updated } : t)) ?? []
      )
    },
    [setTemplates]
  )

  const deleteTemplate = useCallback(
    (id: string) => {
      setTemplates((prev) => prev?.filter((t) => t.id !== id) ?? [])
    },
    [setTemplates]
  )

  const incrementUsageCount = useCallback(
    (id: string) => {
      setTemplates(
        (prev) =>
          prev?.map((t) =>
            t.id === id ? { ...t, usageCount: (t.usageCount || 0) + 1 } : t
          ) ?? []
      )
    },
    [setTemplates]
  )

  const duplicateTemplate = useCallback(
    (id: string) => {
      const template = templates?.find((t) => t.id === id)
      if (template) {
        const duplicated: PromptTemplate = {
          ...template,
          id: crypto.randomUUID(),
          title: `${template.title} (Copy)`,
          createdAt: new Date(),
          usageCount: 0
        }
        setTemplates((prev) => [...(prev || []), duplicated])
      }
    },
    [templates, setTemplates]
  )

  const importTemplates = useCallback(
    (newTemplates: PromptTemplate[]) => {
      const templatesWithDefaults = newTemplates.map((template) => ({
        ...template,
        createdAt: template.createdAt || new Date(),
        usageCount: template.usageCount || 0
      }))
      setTemplates((prev) => [...(prev || []), ...templatesWithDefaults])
    },
    [setTemplates]
  )

  const exportTemplates = useCallback(() => {
    return templates || []
  }, [templates])

  const resetToDefaults = useCallback(() => {
    setTemplates(DEFAULT_PROMPT_TEMPLATES)
  }, [setTemplates])

  const getTemplatesByCategory = useCallback(
    (category: string) => {
      return templates?.filter((t) => t.category === category) || []
    },
    [templates]
  )

  const searchTemplates = useCallback(
    (query: string) => {
      if (!query.trim()) return templates || []

      const searchTerm = query.toLowerCase().trim()
      return (
        templates?.filter(
          (template) =>
            template.title.toLowerCase().includes(searchTerm) ||
            template.description?.toLowerCase().includes(searchTerm) ||
            template.userPrompt.toLowerCase().includes(searchTerm) ||
            template.tags?.some((tag) =>
              tag.toLowerCase().includes(searchTerm)
            ) ||
            template.category?.toLowerCase().includes(searchTerm)
        ) || []
      )
    },
    [templates]
  )

  const getCategories = useCallback(() => {
    const categories = new Set(
      templates?.map((t) => t.category).filter(Boolean) || []
    )
    return Array.from(categories).sort()
  }, [templates])

  const getPopularTemplates = useCallback(
    (limit: number = 5) => {
      return [...(templates || [])]
        .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))
        .slice(0, limit)
    },
    [templates]
  )

  const getRecentTemplates = useCallback(
    (limit: number = 5) => {
      return [...(templates || [])]
        .sort(
          (a, b) =>
            (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)
        )
        .slice(0, limit)
    },
    [templates]
  )

  return {
    templates: effectiveTemplates,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    incrementUsageCount,
    duplicateTemplate,
    importTemplates,
    exportTemplates,
    resetToDefaults,
    getTemplatesByCategory,
    searchTemplates,
    getCategories,
    getPopularTemplates,
    getRecentTemplates
  }
}
