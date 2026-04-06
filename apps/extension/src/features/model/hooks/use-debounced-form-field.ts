import type { UseFormWatch } from "react-hook-form"
import { useDebounce } from "@/hooks/use-debounce"
import type { ModelConfig } from "@/types"

/**
 * Hook to watch and debounce form field values for storage updates
 */
export const useDebouncedFormField = <T extends keyof ModelConfig>(
  watch: UseFormWatch<Record<string, unknown>>,
  fieldName: T,
  delay: number = 500
): ModelConfig[T] => {
  const value = watch(fieldName as string)
  return useDebounce(value, delay) as ModelConfig[T]
}
