import { useState, type SetStateAction } from "react"

/**
 * Keep an editable draft aligned with a changing external value without an
 * effect-driven render. When the source key changes, the external value is
 * displayed until the user edits it against the new source.
 */
export const useSynchronizedDraft = <T>(
  sourceKey: string,
  sourceValue: T
): [T, (next: SetStateAction<T>) => void] => {
  const [stored, setStored] = useState({ sourceKey, value: sourceValue })
  if (stored.sourceKey !== sourceKey) {
    setStored({ sourceKey, value: sourceValue })
  }
  const value = stored.sourceKey === sourceKey ? stored.value : sourceValue

  const update = (next: SetStateAction<T>) => {
    setStored((current) => {
      const currentValue =
        current.sourceKey === sourceKey ? current.value : sourceValue
      return {
        sourceKey,
        value:
          typeof next === "function"
            ? (next as (previous: T) => T)(currentValue)
            : next
      }
    })
  }

  return [value, update]
}
