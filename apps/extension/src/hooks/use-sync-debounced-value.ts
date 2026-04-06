import { useEffect } from "react"

export const useSyncDebouncedValue = <T extends Record<string, unknown>>(
  fieldName: keyof T,
  debouncedValue: T[keyof T],
  currentValue: T[keyof T],
  updateConfig: (updates: Partial<T>) => void,
  validation?: (value: T[keyof T]) => boolean
) => {
  useEffect(() => {
    if (debouncedValue === currentValue) return
    if (validation && !validation(debouncedValue)) return
    updateConfig({ [fieldName]: debouncedValue } as Partial<T>)
  }, [debouncedValue, currentValue, fieldName, updateConfig, validation])
}
