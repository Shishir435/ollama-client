import { z } from "zod"
import type { PromptTemplate } from "@/types/ui-state"
import { PromptTemplateSchema } from "@/types/ui-state.schemas"

const LegacyNameOnlyPromptTemplateSchema = z
  .object({ name: z.string().trim().min(1) })
  .passthrough()

const legacyTemplateId = (name: string, index: number): string => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
  return `legacy-prompt-${index + 1}${slug ? `-${slug}` : ""}`
}

export const parseLegacyPromptTemplate = (
  value: unknown,
  index: number
): PromptTemplate | null => {
  const current = PromptTemplateSchema.safeParse(value)
  if (current.success) return current.data as PromptTemplate

  const legacy = LegacyNameOnlyPromptTemplateSchema.safeParse(value)
  if (!legacy.success) return null

  return PromptTemplateSchema.parse({
    id: legacyTemplateId(legacy.data.name, index),
    title: legacy.data.name,
    userPrompt: legacy.data.name
  }) as PromptTemplate
}

/**
 * The earliest prompt store also admitted name-only objects. They contain no
 * separate prompt body, so preserve the only user-authored text as both title
 * and prompt while assigning a stable, position-qualified id.
 */
export const LegacyPromptTemplatesSchema = z
  .array(z.unknown())
  .transform((values, context) => {
    const templates = values.map((value, index) => {
      const template = parseLegacyPromptTemplate(value, index)
      if (!template) {
        context.addIssue({
          code: "custom",
          message: "Invalid legacy prompt template",
          path: [index]
        })
        return null
      }
      return template
    })

    return templates.some((template) => template === null) ? z.NEVER : templates
  })
