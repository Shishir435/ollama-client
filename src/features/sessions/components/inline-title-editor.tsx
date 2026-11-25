import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import {
  MAX_SESSION_TITLE_LENGTH,
  normalizeSessionTitle
} from "@/features/sessions/stores/chat-session-list-actions"
import { toast } from "@/hooks/use-toast"
import { cn } from "@/lib/class-names"

/**
 * Edits a chat title in place. Enter or leaving the field saves, Escape
 * restores, and a title that is empty after trimming changes nothing — the old
 * one stays rather than a chat with no name. A failed save keeps the editor and
 * its draft for a retry.
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
  /** `refocus` is true after Enter or Escape, when focus should return. */
  onClose: (refocus: boolean) => void
  className?: string
}) => {
  const { t } = useTranslation()
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

  const settle = (save: boolean, refocus: boolean) => {
    if (settledRef.current) return
    settledRef.current = true
    const title = normalizeSessionTitle(draft)
    if (save && title && title !== value) {
      void Promise.resolve()
        .then(() => onSave(title))
        .then(
          () => onClose(refocus),
          () => {
            settledRef.current = false
            toast({
              variant: "destructive",
              title: t("sessions.rename.failed")
            })
          }
        )
      return
    }
    onClose(refocus)
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
      onBlur={() => settle(true, false)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.nativeEvent.isComposing) return
        if (event.key === "Enter") {
          event.preventDefault()
          settle(true, true)
        } else if (event.key === "Escape") {
          event.preventDefault()
          settle(false, true)
        }
      }}
    />
  )
}
