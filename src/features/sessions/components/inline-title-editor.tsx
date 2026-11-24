import { useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import {
  MAX_SESSION_TITLE_LENGTH,
  normalizeSessionTitle
} from "@/features/sessions/stores/chat-session-list-actions"
import { cn } from "@/lib/class-names"

/**
 * Edits a chat title in place. Enter or leaving the field saves, Escape
 * restores, and a title that is empty after trimming changes nothing — the old
 * one stays rather than a chat with no name.
 */
export const InlineTitleEditor = ({
  value,
  ariaLabel,
  onSave,
  onClose,
  className
}: {
  value: string
  ariaLabel: string
  /** Called with the normalized title; only when it differs from `value`. */
  onSave: (title: string) => Promise<unknown> | unknown
  onClose: () => void
  className?: string
}) => {
  const [draft, setDraft] = useState(value)
  /** One outcome per edit: Enter then the blur it causes must not save twice. */
  const settledRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  /**
   * Focus a frame late: opened from a menu, the menu hands focus back to its
   * trigger as it closes, and an input focused any earlier loses it, which
   * would read as a blur and close the editor before a key was typed.
   */
  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  const settle = (save: boolean) => {
    if (settledRef.current) return
    settledRef.current = true
    const title = normalizeSessionTitle(draft)
    if (save && title && title !== value) {
      void Promise.resolve(onSave(title)).finally(onClose)
      return
    }
    onClose()
  }

  return (
    <Input
      ref={inputRef}
      value={draft}
      maxLength={MAX_SESSION_TITLE_LENGTH}
      aria-label={ariaLabel}
      className={cn("h-7 text-xs", className)}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => settle(true)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.nativeEvent.isComposing) return
        if (event.key === "Enter") {
          event.preventDefault()
          settle(true)
        } else if (event.key === "Escape") {
          event.preventDefault()
          settle(false)
        }
      }}
    />
  )
}
