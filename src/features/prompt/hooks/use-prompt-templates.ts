import { useCallback, useEffect, useMemo, useState } from "react"
import { DEFAULT_PROMPT_TEMPLATES } from "@/lib/constants"
import {
  addPromptTemplate,
  deletePromptTemplate,
  incrementPromptTemplateUsage,
  listPromptTemplates,
  logPromptTemplateError,
  importPromptTemplates as persistImportedTemplates,
  replacePromptTemplates,
  subscribePromptTemplates,
  updatePromptTemplate
} from "@/lib/repositories/prompt-templates"
import type { PromptTemplate } from "@/types/ui-state"
import { PromptTemplateSchema } from "@/types/ui-state.schemas"

const normalizeImportedTemplate = (
  value: unknown,
  existingIds: Set<string>
): PromptTemplate | null => {
  const parsed = PromptTemplateSchema.safeParse(value)
  if (!parsed.success) return null
  const rawId = parsed.data.id.trim() || crypto.randomUUID()
  const id = existingIds.has(rawId) ? crypto.randomUUID() : rawId
  existingIds.add(id)
  return { ...parsed.data, id } as PromptTemplate
}

export const usePromptTemplates = () => {
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const reload = useCallback(async () => {
    try {
      setTemplates(await listPromptTemplates())
    } catch (error) {
      logPromptTemplateError(error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    return subscribePromptTemplates(() => void reload())
  }, [reload])

  const persist = useCallback(
    (work: () => Promise<void>) => {
      void work().catch((error) => {
        logPromptTemplateError(error)
        void reload()
      })
    },
    [reload]
  )

  const addTemplate = useCallback(
    (template: Omit<PromptTemplate, "createdAt" | "usageCount">) => {
      const next: PromptTemplate = {
        ...template,
        createdAt: new Date(),
        usageCount: 0
      }
      setTemplates((current) => [...current, next])
      persist(() => addPromptTemplate(next))
    },
    [persist]
  )

  const updateTemplate = useCallback(
    (id: string, updated: Partial<PromptTemplate>) => {
      setTemplates((current) =>
        current.map((template) =>
          template.id === id ? { ...template, ...updated, id } : template
        )
      )
      persist(() => updatePromptTemplate(id, updated))
    },
    [persist]
  )

  const deleteTemplate = useCallback(
    (id: string) => {
      setTemplates((current) =>
        current.filter((template) => template.id !== id)
      )
      persist(() => deletePromptTemplate(id))
    },
    [persist]
  )

  const incrementUsageCount = useCallback(
    (id: string) => {
      setTemplates((current) =>
        current.map((template) =>
          template.id === id
            ? { ...template, usageCount: (template.usageCount ?? 0) + 1 }
            : template
        )
      )
      persist(() => incrementPromptTemplateUsage(id))
    },
    [persist]
  )

  const duplicateTemplate = useCallback(
    (id: string) => {
      const template = templates.find((item) => item.id === id)
      if (!template) return
      const copy: PromptTemplate = {
        ...template,
        id: crypto.randomUUID(),
        title: `${template.title} (Copy)`,
        createdAt: new Date(),
        usageCount: 0
      }
      setTemplates((current) => [...current, copy])
      persist(() => addPromptTemplate(copy))
    },
    [persist, templates]
  )

  const importTemplates = useCallback(
    (values: unknown) => {
      if (!Array.isArray(values) || values.length === 0) return
      const existingIds = new Set(templates.map((template) => template.id))
      const imported = values
        .map((value) => normalizeImportedTemplate(value, existingIds))
        .filter((template): template is PromptTemplate => template !== null)
      if (imported.length === 0) return
      setTemplates((current) => [...current, ...imported])
      persist(() => persistImportedTemplates(imported))
    },
    [persist, templates]
  )

  const exportTemplates = useCallback(
    () =>
      templates.filter(
        (template) => PromptTemplateSchema.safeParse(template).success
      ),
    [templates]
  )

  const resetToDefaults = useCallback(() => {
    const defaults = DEFAULT_PROMPT_TEMPLATES.map((template) => ({
      ...template,
      createdAt: template.createdAt ?? new Date()
    }))
    setTemplates(defaults)
    persist(() => replacePromptTemplates(defaults))
  }, [persist])

  const getTemplatesByCategory = useCallback(
    (category: string) =>
      templates.filter((template) => template.category === category),
    [templates]
  )

  const searchTemplates = useCallback(
    (queryText: string) => {
      const term = queryText.toLowerCase().trim()
      if (!term) return templates
      return templates.filter(
        (template) =>
          template.title.toLowerCase().includes(term) ||
          template.description?.toLowerCase().includes(term) ||
          template.userPrompt.toLowerCase().includes(term) ||
          template.tags?.some((tag) => tag.toLowerCase().includes(term)) ||
          template.category?.toLowerCase().includes(term)
      )
    },
    [templates]
  )

  const getCategories = useCallback(
    () =>
      Array.from(
        new Set(
          templates
            .map((template) => template.category)
            .filter((category): category is string => Boolean(category))
        )
      ).sort(),
    [templates]
  )

  const getPopularTemplates = useCallback(
    (limit = 5) =>
      [...templates]
        .sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0))
        .slice(0, limit),
    [templates]
  )

  const getRecentTemplates = useCallback(
    (limit = 5) =>
      [...templates]
        .sort(
          (a, b) =>
            (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)
        )
        .slice(0, limit),
    [templates]
  )

  return useMemo(
    () => ({
      templates,
      isLoading,
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
    }),
    [
      templates,
      isLoading,
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
    ]
  )
}
