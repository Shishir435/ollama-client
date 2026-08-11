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
    unload_on_switch: z.boolean().optional()
  })
  .partial()
  .passthrough()

export const ModelConfigMapSchema = z.record(z.string(), ModelConfigSchema)

export type StoredModelConfigMap = Record<string, Partial<ModelConfig>>

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
