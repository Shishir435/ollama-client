import { useStorage } from "@plasmohq/storage/hook"
import { useCallback } from "react"
import { DEFAULT_PROMPT_TEMPLATES, STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { PromptTemplate } from "@/types"

const normalizeCreatedAt = (value: unknown): Date => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date
  }
  return new Date()
}

const normalizeImportedTemplate = (
  value: unknown,
  existingIds: Set<string>
): PromptTemplate | null => {
  if (!value || typeof value !== "object") return null

  const candidate = value as Partial<PromptTemplate>
  if (
    typeof candidate.title !== "string" ||
    !candidate.title.trim() ||
    typeof candidate.userPrompt !== "string" ||
    !candidate.userPrompt.trim()
  ) {
    return null
  }

  const rawId =
    typeof candidate.id === "string" && candidate.id.trim()
      ? candidate.id.trim()
      : crypto.randomUUID()
  const id = existingIds.has(rawId) ? crypto.randomUUID() : rawId
  existingIds.add(id)

  return {
    id,
    title: candidate.title.trim(),
    description:
      typeof candidate.description === "string"
        ? candidate.description
        : undefined,
    category:
      typeof candidate.category === "string" ? candidate.category : undefined,
    systemPrompt:
      typeof candidate.systemPrompt === "string"
        ? candidate.systemPrompt
        : undefined,
    userPrompt: candidate.userPrompt.trim(),
    tags: Array.isArray(candidate.tags)
      ? candidate.tags.filter((tag): tag is string => typeof tag === "string")
      : undefined,
    createdAt: normalizeCreatedAt(candidate.createdAt),
    usageCount:
      typeof candidate.usageCount === "number" && candidate.usageCount >= 0
        ? candidate.usageCount
        : 0
  }
}

export const usePromptTemplates = () => {
  const [templates, setTemplates] = useStorage<PromptTemplate[]>(
    {
      key: STORAGE_KEYS.PROVIDER.PROMPT_TEMPLATES,
      instance: plasmoGlobalStorage
    },
    DEFAULT_PROMPT_TEMPLATES
  )

  const effectiveTemplates =
    templates && templates.length > 0
      ? templates.map((t) => ({
          ...t,
          createdAt: normalizeCreatedAt(t.createdAt)
        }))
      : DEFAULT_PROMPT_TEMPLATES.map((t) => ({
          ...t,
          createdAt: normalizeCreatedAt(t.createdAt)
        }))

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
    (newTemplates: unknown[]) => {
      setTemplates((prev) => {
        const current = prev || []
        const existingIds = new Set(current.map((template) => template.id))
        const normalized = newTemplates
          .map((template) => normalizeImportedTemplate(template, existingIds))
          .filter((template): template is PromptTemplate => Boolean(template))

        return [...current, ...normalized]
      })
    },
    [setTemplates]
  )

  const exportTemplates = useCallback(() => {
    return effectiveTemplates
  }, [effectiveTemplates])

  const resetToDefaults = useCallback(() => {
    setTemplates(DEFAULT_PROMPT_TEMPLATES)
  }, [setTemplates])

  const getTemplatesByCategory = useCallback(
    (category: string) => {
      return effectiveTemplates.filter((t) => t.category === category)
    },
    [effectiveTemplates]
  )

  const searchTemplates = useCallback(
    (query: string) => {
      if (!query.trim()) return effectiveTemplates

      const searchTerm = query.toLowerCase().trim()
      return effectiveTemplates.filter(
        (template) =>
          template.title.toLowerCase().includes(searchTerm) ||
          template.description?.toLowerCase().includes(searchTerm) ||
          template.userPrompt.toLowerCase().includes(searchTerm) ||
          template.tags?.some((tag) =>
            tag.toLowerCase().includes(searchTerm)
          ) ||
          template.category?.toLowerCase().includes(searchTerm)
      )
    },
    [effectiveTemplates]
  )

  const getCategories = useCallback(() => {
    const categories = new Set(
      effectiveTemplates.map((t) => t.category).filter(Boolean)
    )
    return Array.from(categories).sort()
  }, [effectiveTemplates])

  const getPopularTemplates = useCallback(
    (limit: number = 5) => {
      return [...effectiveTemplates]
        .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))
        .slice(0, limit)
    },
    [effectiveTemplates]
  )

  const getRecentTemplates = useCallback(
    (limit: number = 5) => {
      return [...effectiveTemplates]
        .sort(
          (a, b) =>
            (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)
        )
        .slice(0, limit)
    },
    [effectiveTemplates]
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
