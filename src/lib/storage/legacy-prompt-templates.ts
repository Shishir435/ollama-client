import { z } from "zod"
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

/**
 * The earliest prompt store also admitted name-only objects. They contain no
 * separate prompt body, so preserve the only user-authored text as both title
 * and prompt while assigning a stable, position-qualified id.
 */
export const LegacyPromptTemplatesSchema = z
  .array(z.unknown())
  .transform((values, context) => {
    const templates = values.map((value, index) => {
      const current = PromptTemplateSchema.safeParse(value)
      if (current.success) return current.data

      const legacy = LegacyNameOnlyPromptTemplateSchema.safeParse(value)
      if (!legacy.success) {
        context.addIssue({
          code: "custom",
          message: "Invalid legacy prompt template",
          path: [index]
        })
        return null
      }

      return PromptTemplateSchema.parse({
        id: legacyTemplateId(legacy.data.name, index),
        title: legacy.data.name,
        userPrompt: legacy.data.name
      })
    })

    return templates.some((template) => template === null) ? z.NEVER : templates
  })
