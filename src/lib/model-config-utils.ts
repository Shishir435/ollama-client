import { z } from "zod"
import {
  DEFAULT_MODEL_CONFIG,
  LEGACY_DEFAULT_MODEL_CONTEXT_SIZE
} from "@/lib/constants"
import type { ModelConfig } from "@/types"

export const ModelConfigSchema = z
  .object({
    temperature: z.number(),
    top_k: z.number(),
    top_p: z.number(),
    repeat_penalty: z.number(),
    stop: z.array(z.string()),
    system: z.string(),
    num_ctx: z.number(),
    repeat_last_n: z.number(),
    seed: z.number(),
    num_predict: z.number(),
    min_p: z.number(),
    num_thread: z.number().optional(),
    num_gpu: z.number().optional(),
    num_batch: z.number().optional(),
    keep_alive: z.union([z.string(), z.number()]).optional(),
    warm_on_select: z.boolean().optional(),
    unload_on_switch: z.boolean().optional(),
    reasoning_effort: z
      .enum([
        "auto",
        "enabled",
        "none",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ])
      .optional()
  })
  .partial()
  .passthrough()

export const ModelConfigMapSchema = z.record(z.string(), ModelConfigSchema)

export type StoredModelConfigMap = Record<string, Partial<ModelConfig>>

export const modelConfigKey = (model: string, providerId?: string): string =>
  providerId ? `${providerId}::${model}` : model

/**
 * Prefer the provider-scoped entry. Bare model keys remain a read fallback for
 * provider-neutral settings written before model configs became
 * collision-safe. Reasoning effort is provider-specific and must never cross
 * that boundary.
 */
export const getStoredModelConfig = (
  configs: StoredModelConfigMap,
  model: string,
  providerId?: string
): Partial<ModelConfig> | undefined => {
  const scoped = configs[modelConfigKey(model, providerId)]
  if (scoped || !providerId) return scoped

  const legacy = configs[model]
  if (!legacy || legacy.reasoning_effort === undefined) return legacy

  const safeLegacy = { ...legacy }
  delete safeLegacy.reasoning_effort
  return safeLegacy
}

export const parseStoredModelConfigMap = (
  value: unknown
): StoredModelConfigMap => {
  const parsed = ModelConfigMapSchema.safeParse(value)
  return parsed.success ? parsed.data : {}
}

export const normalizeStoredModelConfig = (
  stored?: Partial<ModelConfig>
): Partial<ModelConfig> | undefined => {
  if (!stored) return undefined

  if (stored.num_ctx === LEGACY_DEFAULT_MODEL_CONTEXT_SIZE) {
    return {
      ...stored,
      num_ctx: DEFAULT_MODEL_CONFIG.num_ctx
    }
  }

  return stored
}

export const resolveModelConfig = (
  stored?: Partial<ModelConfig>
): ModelConfig => ({
  ...DEFAULT_MODEL_CONFIG,
  ...(normalizeStoredModelConfig(stored) ?? {})
})
