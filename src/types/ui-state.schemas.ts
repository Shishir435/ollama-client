import { z } from "zod"
import type { PromptTemplate, Theme } from "./ui-state"

// ---- PromptTemplate ----

export const PromptTemplateSchema = z.object({
  id: z.string(),
  title: z.string().trim().min(1),
  userPrompt: z.string().trim().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  systemPrompt: z.string().optional(),
  tags: z
    .unknown()
    .optional()
    .transform((v) =>
      Array.isArray(v)
        ? v.filter((t): t is string => typeof t === "string")
        : undefined
    ),
  createdAt: z
    .union([z.string(), z.number(), z.date()])
    .optional()
    .transform((v) =>
      v instanceof Date ? v : v != null ? new Date(v) : new Date()
    ),
  usageCount: z.number().min(0).optional().default(0)
})

// ---- Theme ----

export const ThemeSchema = z.enum(["dark", "light", "system"])

// ---- Zustand persisted state wrapper (minimal) ----

export const ZustandPersistedStateSchema = z
  .object({
    state: z.record(z.string(), z.unknown())
  })
  .passthrough()

// ---- Compile-time conformance checks ----

void (0 as unknown as z.infer<
  typeof PromptTemplateSchema
> satisfies PromptTemplate)
void (0 as unknown as z.infer<typeof ThemeSchema> satisfies Theme)
