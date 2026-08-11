import { z } from "zod"
import { createAppError } from "@/lib/error-utils"
import {
  type ProviderConfig,
  ProviderServiceProfile,
  ProviderType
} from "./types"

const OptionalStringSchema = z.string().optional().catch(undefined)

const OpenAICompatibilityOptionsSchema = z
  .object({
    maxTokensField: z
      .enum(["max_tokens", "max_completion_tokens"])
      .optional()
      .catch(undefined),
    sendStreamOptions: z.enum(["always", "never"]).optional().catch(undefined)
  })
  .passthrough()

/**
 * Required identity fields reject the entry. Optional legacy fields recover
 * independently so one stale preference does not discard a usable provider.
 * Unknown fields survive downgrade/upgrade cycles.
 */
export const ProviderConfigSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum([
      ProviderType.OLLAMA,
      ProviderType.OPENAI,
      ProviderType.ANTHROPIC,
      ProviderType.CUSTOM
    ]),
    enabled: z.boolean(),
    baseUrl: OptionalStringSchema,
    apiKey: OptionalStringSchema,
    modelId: OptionalStringSchema,
    name: z.string().min(1),
    customModels: z.array(z.string()).optional().catch(undefined),
    serviceProfile: z
      .enum([
        ProviderServiceProfile.GENERIC,
        ProviderServiceProfile.OPENAI,
        ProviderServiceProfile.ANTHROPIC,
        ProviderServiceProfile.OPENROUTER
      ])
      .optional()
      .catch(undefined),
    compatibility: OpenAICompatibilityOptionsSchema.optional().catch(undefined)
  })
  .passthrough()

export interface StoredProviderConfigParseResult {
  providers: ProviderConfig[]
  rejected: number
  normalized: boolean
}

export const parseStoredProviderConfigs = (
  value: unknown
): StoredProviderConfigParseResult => {
  if (!Array.isArray(value)) {
    return {
      providers: [],
      rejected: value === undefined || value === null ? 0 : 1,
      normalized: value !== undefined && value !== null
    }
  }

  const providers: ProviderConfig[] = []
  let rejected = 0
  for (const entry of value) {
    const parsed = ProviderConfigSchema.safeParse(entry)
    if (parsed.success) providers.push(parsed.data)
    else rejected += 1
  }

  return {
    providers,
    rejected,
    normalized:
      rejected > 0 || JSON.stringify(providers) !== JSON.stringify(value)
  }
}

export const validateProviderConfigs = (value: unknown): ProviderConfig[] => {
  const parsed = z.array(ProviderConfigSchema).safeParse(value)
  if (!parsed.success) {
    throw createAppError("Provider configuration is invalid", {
      kind: "validation",
      phase: "configuration"
    })
  }
  return parsed.data
}
