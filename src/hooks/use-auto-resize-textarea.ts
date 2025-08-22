import { useLayoutEffect } from "react"

export const useAutoResizeTextarea = (
  ref: React.RefObject<HTMLTextAreaElement>,
  value: string,
  minHeight = 100,
  maxHeight = 300
) => {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    // 💥 Force initial height to 100px on first mount
    if (value === "") {
      el.style.height = `${minHeight}px`
      el.style.overflowY = "hidden"
      return
    }

    // Dynamic resizing
    el.style.height = "auto"
    const scrollHeight = el.scrollHeight
    const clampedHeight = Math.max(minHeight, Math.min(scrollHeight, maxHeight))
    el.style.height = `${clampedHeight}px`
    el.style.overflowY = scrollHeight > maxHeight ? "auto" : "hidden"
  }, [ref, value, minHeight, maxHeight])
}
