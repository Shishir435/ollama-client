import { z } from "zod"
import {
  AUTO_CONTEXT_SIZE,
  DEFAULT_MODEL_CONFIG,
  LEGACY_DEFAULT_MODEL_CONTEXT_SIZE,
  PREVIOUS_DEFAULT_MODEL_CONTEXT_SIZE
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
    /** Set when the user chose `num_ctx` themselves; see {@link normalizeStoredModelConfig}. */
    num_ctx_pinned: z.boolean().optional(),
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

/**
 * Bring a stored config forward.
 *
 * - `6144` was the default two defaults ago and is never a choice: it becomes
 *   the current default.
 * - `65536` was the default before Auto. It is Auto now, unless the user chose
 *   it themselves after that change — `num_ctx_pinned`, which a write from the
 *   settings form sets — because the number alone cannot tell a stored default
 *   from a stored decision. Any other value is the user's and is left alone.
 */
export const normalizeStoredModelConfig = (
  stored?: Partial<ModelConfig> & { num_ctx_pinned?: boolean }
): Partial<ModelConfig> | undefined => {
  if (!stored) return undefined

  if (stored.num_ctx === LEGACY_DEFAULT_MODEL_CONTEXT_SIZE) {
    return {
      ...stored,
      num_ctx: DEFAULT_MODEL_CONFIG.num_ctx
    }
  }

  if (
    stored.num_ctx === PREVIOUS_DEFAULT_MODEL_CONTEXT_SIZE &&
    !stored.num_ctx_pinned
  ) {
    return { ...stored, num_ctx: AUTO_CONTEXT_SIZE }
  }

  return stored
}

const sameValue = (a: unknown, b: unknown): boolean =>
  a === b ||
  (Array.isArray(a) &&
    Array.isArray(b) &&
    JSON.stringify(a) === JSON.stringify(b))

/**
 * Only the fields a user changed. Every reader resolves through
 * `resolveModelConfig`, so a field equal to its default says nothing — and a
 * full copy of the defaults per model, system prompt included, filled the old
 * sync map's 8 KB item quota after about a dozen models. It also lets a later
 * default reach a user who never changed that field, and lets "the user set a
 * system prompt" mean exactly that. An entry stays even when empty, because its
 * presence is what keeps a bare legacy key from being read.
 */
export const compactModelConfig = (
  stored: Partial<ModelConfig>
): Partial<ModelConfig> => {
  const normalized = normalizeStoredModelConfig(stored) ?? {}
  const defaults = DEFAULT_MODEL_CONFIG as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(normalized).filter(
      ([key, value]) =>
        value !== undefined &&
        !(key in defaults && sameValue(value, defaults[key]))
    )
  ) as Partial<ModelConfig>
}

export const resolveModelConfig = (
  stored?: Partial<ModelConfig>
): ModelConfig => ({
  ...DEFAULT_MODEL_CONFIG,
  ...normalizeStoredModelConfig(stored)
})
