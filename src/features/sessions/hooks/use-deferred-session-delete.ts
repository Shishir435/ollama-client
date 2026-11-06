import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "@/hooks/use-toast"

/** How long Undo stays available before the chat is really deleted. */
export const SESSION_DELETE_UNDO_MS = 8000

/**
 * Delete a chat after a short Undo window.
 *
 * A deleted chat takes its messages, files and vectors with it, so nothing
 * can be put back afterwards. The chat is hidden at once instead and the real
 * delete runs when the window closes, unless Undo came first. Whatever is
 * still pending is committed when the panel unloads, so a hidden chat never
 * comes back on the next open.
 */
export const useDeferredSessionDelete = (
  deleteSession: (id: string) => Promise<void> | void
) => {
  const { t } = useTranslation()
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const pending = useRef(
    new Map<string, { timer: ReturnType<typeof setTimeout> }>()
  )
  const deleteRef = useRef(deleteSession)
  useEffect(() => {
    deleteRef.current = deleteSession
  }, [deleteSession])

  const unhide = useCallback((id: string) => {
    setHiddenIds((current) => {
      if (!current.has(id)) return current
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }, [])

  const commit = useCallback(
    (id: string) => {
      const entry = pending.current.get(id)
      if (!entry) return
      clearTimeout(entry.timer)
      pending.current.delete(id)
      void Promise.resolve(deleteRef.current(id)).finally(() => unhide(id))
    },
    [unhide]
  )

  const schedule = useCallback(
    (id: string) => {
      if (pending.current.has(id)) return
      setHiddenIds((current) => new Set(current).add(id))
      toast({
        title: t("sessions.delete.done"),
        duration: SESSION_DELETE_UNDO_MS,
        action: {
          label: t("sessions.delete.undo"),
          onClick: () => {
            const entry = pending.current.get(id)
            if (!entry) return
            clearTimeout(entry.timer)
            pending.current.delete(id)
            unhide(id)
          }
        }
      })
      pending.current.set(id, {
        timer: setTimeout(() => commit(id), SESSION_DELETE_UNDO_MS)
      })
    },
    [commit, t, unhide]
  )

  useEffect(() => {
    const flush = () => {
      for (const id of Array.from(pending.current.keys())) commit(id)
    }
    window.addEventListener("pagehide", flush)
    return () => {
      window.removeEventListener("pagehide", flush)
      flush()
    }
  }, [commit])

  return { hiddenIds, schedule }
}
