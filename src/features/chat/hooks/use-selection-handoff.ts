import type { RefObject } from "react"
import { useCallback, useEffect, useRef } from "react"
import { chatInputStore } from "@/features/chat/stores/chat-input-store"
import { chatSessionStore } from "@/features/sessions/stores/chat-session-store"
import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { getPlasmoStorageForKey } from "@/lib/plasmo-global-storage"
import { SelectionChatHandoffSchema } from "@/protocol/selection-handoff"

const storage = getPlasmoStorageForKey(
  STORAGE_KEYS.BROWSER.PENDING_SELECTION_TEXT
)

/** Keep legacy quote formatting while the new-chat handoff gets a clean composer. */
const selectionDraft = (text: string) => {
  const breakAt = text.indexOf("\n\n")
  return breakAt === -1
    ? `> ${text.split("\n").join("\n> ")}\n`
    : `> ${text.slice(0, breakAt).split("\n").join("\n> ")}\n\n${text.slice(breakAt + 2).trim()}`
}

/** Consume storage, port and runtime deliveries once; the background creates new sessions. */
export function useSelectionHandoff({
  textareaRef,
  onNewChat,
  onError
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onNewChat: () => void
  onError: () => void
}) {
  const lastAppend = useRef<{ text: string; at: number } | null>(null)
  const consumed = useRef(new Set<string>())
  const consume = useCallback(
    async (raw: unknown) => {
      const parsed = SelectionChatHandoffSchema.safeParse(raw)
      if (!parsed.success) return
      const handoff = parsed.data
      const id = typeof handoff === "string" ? undefined : handoff.sessionId
      if (id && consumed.current.has(id)) return
      if (id) consumed.current.add(id)
      let applied = false
      try {
        const input = chatInputStore.getState()
        if (typeof handoff === "string") {
          const last = lastAppend.current
          if (!(last?.text === handoff && Date.now() - last.at < 2000)) {
            lastAppend.current = { text: handoff, at: Date.now() }
            input.appendInput(selectionDraft(handoff))
          }
        } else {
          if (handoff.windowId !== undefined) {
            const window = await browser.windows.getCurrent()
            if (window.id !== handoff.windowId) {
              consumed.current.delete(handoff.sessionId)
              return
            }
          }
          await chatSessionStore.getState().refreshSessions()
          const sessions = chatSessionStore.getState()
          if (
            !sessions.sessions.some(
              (session) => session.id === handoff.sessionId
            )
          )
            throw new Error("Selection chat unavailable")
          sessions.setCurrentSessionId(handoff.sessionId)
          onNewChat()
          input.clearPendingChatSend()
          input.dropAgentFollowUp()
          input.setInput(selectionDraft(handoff.text))
          if (consumed.current.size > 64) {
            const oldest = consumed.current.values().next().value
            if (oldest) consumed.current.delete(oldest)
          }
        }
        applied = true
        textareaRef.current?.focus()
        const pending = SelectionChatHandoffSchema.safeParse(
          await storage.get<unknown>(
            STORAGE_KEYS.BROWSER.PENDING_SELECTION_TEXT
          )
        )
        if (
          pending.success &&
          (typeof handoff === "string"
            ? pending.data === handoff
            : typeof pending.data !== "string" &&
              pending.data.sessionId === handoff.sessionId)
        ) {
          await storage.remove(STORAGE_KEYS.BROWSER.PENDING_SELECTION_TEXT)
        }
      } catch {
        if (id && !applied) consumed.current.delete(id)
        onError()
      }
    },
    [onError, onNewChat, textareaRef]
  )

  useEffect(() => {
    void storage
      .get<unknown>(STORAGE_KEYS.BROWSER.PENDING_SELECTION_TEXT)
      .then(consume)
      .catch(onError)
    const watch = {
      [STORAGE_KEYS.BROWSER.PENDING_SELECTION_TEXT]: (change: {
        newValue?: unknown
      }) => {
        if (change.newValue) void consume(change.newValue)
      }
    }
    storage.watch(watch)
    const port = browser.runtime.connect({
      name: MESSAGE_KEYS.BROWSER.SELECTION_BRIDGE_PORT
    })
    const receive = (raw: unknown) => {
      if (!raw || typeof raw !== "object") return
      const message = raw as {
        type?: unknown
        payload?: unknown
        fromBackground?: unknown
      }
      if (
        message.type === MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT &&
        message.fromBackground === true
      )
        void consume(message.payload)
    }
    port.onMessage.addListener(receive)
    browser.runtime.onMessage.addListener(receive)
    return () => {
      storage.unwatch(watch)
      port.onMessage.removeListener(receive)
      port.disconnect()
      browser.runtime.onMessage.removeListener(receive)
    }
  }, [consume, onError])
}
