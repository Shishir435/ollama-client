import { useEffect } from "react"
import type { ModelConfig } from "@/types"

/**
 * Custom hook to handle debounced form value updates to storage
 * Watches form field and automatically updates storage when value changes
 */
export const useDebouncedFormUpdate = <T extends keyof ModelConfig>(
  fieldName: T,
  debouncedValue: ModelConfig[T],
  currentValue: ModelConfig[T],
  updateConfig: (updates: Partial<ModelConfig>) => void,
  validation?: (value: ModelConfig[T]) => boolean
) => {
  useEffect(() => {
    // Skip if value hasn't changed
    if (debouncedValue === currentValue) return

    // Apply validation if provided
    if (validation && !validation(debouncedValue)) return

    // Update storage
    updateConfig({ [fieldName]: debouncedValue } as Partial<ModelConfig>)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    debouncedValue,
    currentValue,
    fieldName, // Update storage
    updateConfig,
    validation
  ])
}

/**
 * Hook to sync form values with config changes
 */
export const useSyncFormWithConfig = <T extends Record<string, unknown>>(
  config: ModelConfig,
  reset: (values: T) => void,
  _selectedModel: string
) => {
  useEffect(() => {
    reset({
      system: config.system,
      temperature: config.temperature,
      top_k: config.top_k,
      top_p: config.top_p,
      min_p: config.min_p,
      seed: config.seed,
      num_ctx: config.num_ctx,
      num_predict: config.num_predict,
      repeat_penalty: config.repeat_penalty,
      repeat_last_n: config.repeat_last_n
    } as unknown as T)
  }, [config, reset])
}
