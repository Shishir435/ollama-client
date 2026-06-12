import {
  DEFAULT_MODEL_CONFIG,
  LEGACY_DEFAULT_MODEL_CONTEXT_SIZE
} from "@/lib/constants"
import type { ModelConfig } from "@/types"

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
