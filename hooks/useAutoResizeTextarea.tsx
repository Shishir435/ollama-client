import { useLayoutEffect } from "react"

export function useAutoResizeTextarea(
  ref: React.RefObject<HTMLTextAreaElement>,
  value: string,
  minHeight: number = 80,
  maxHeight: number = 300
) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    // Reset height to measure correct scrollHeight
    el.style.height = "auto"

    // Edge case: when there's no content, scrollHeight might return more than needed
    const rawHeight = el.scrollHeight

    // Clamp height manually between minHeight and maxHeight
    const newHeight =
      value.trim() === ""
        ? minHeight
        : Math.max(minHeight, Math.min(rawHeight, maxHeight))

    el.style.height = `${newHeight}px`
  }, [ref, value, minHeight, maxHeight])
}
