import { useEffect } from "react"
import { type Control, useWatch } from "react-hook-form"
import { useDebounce } from "@/hooks/use-debounce"
import type { ModelConfig } from "@/types"

/**
 * Hook to watch form field, debounce it, and sync to storage
 */
export const useDebouncedFormSync = <T extends keyof ModelConfig>(
  control: Control<Record<string, unknown>>,
  fieldName: T,
  currentValue: ModelConfig[T],
  updateConfig: (updates: Partial<ModelConfig>) => void,
  delay: number = 500,
  validation?: (value: ModelConfig[T]) => boolean
) => {
  const watchedValue = useWatch({ control, name: fieldName })
  const debouncedValue = useDebounce(watchedValue, delay)

  useEffect(() => {
    // Skip if value hasn't changed
    if (debouncedValue === currentValue) return

    // Apply validation if provided
    if (validation) {
      const typedValue = debouncedValue as ModelConfig[T]
      if (!validation(typedValue)) return
    }

    // Update storage
    updateConfig({
      [fieldName]: debouncedValue as ModelConfig[T]
    } as Partial<ModelConfig>)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    debouncedValue,
    currentValue,
    fieldName, // Update storage
    updateConfig,
    validation
  ])
}
