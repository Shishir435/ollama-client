import { useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import { useSpeechSynthesis } from "@/features/chat/hooks/use-speech-synthesis"
import { useChatExport } from "@/features/sessions/hooks/use-export-chat"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { useToast } from "@/hooks/use-toast"
import { openOptionsInTab } from "@/lib/browser-api"
import { useSearchDialogStore } from "@/stores/search-dialog-store"
import { useThemeStore } from "@/stores/theme"
import type { ChatMessage } from "@/types"

interface UseChatKeyboardShortcutsParams {
  messages: ChatMessage[]
  currentSessionId: string | null
  createSession: () => Promise<string>
  deleteSession: (id: string) => void | Promise<void>
}

/**
 * Custom hook to handle all keyboard shortcuts for the Chat component
 * Extracted from Chat component to improve testability and maintainability
 */
export const useChatKeyboardShortcuts = ({
  messages,
  currentSessionId,
  createSession,
  deleteSession
}: UseChatKeyboardShortcutsParams) => {
  const { t } = useTranslation()
  const { toggle: toggleSpeech } = useSpeechSynthesis()
  const { toast } = useToast()
  const { sessions } = useChatSessions()
  const { exportSessionAsJson, exportSessionAsPdf } = useChatExport()
  const [clearChatPending, setClearChatPending] = useState(false)

  /** Runs after the user confirms in the chat view's dialog. */
  const confirmClearChat = useCallback(async () => {
    setClearChatPending(false)
    if (!currentSessionId) return
    await deleteSession(currentSessionId)
    await createSession()
    toast({ description: t("chat.shortcuts.cleared") })
  }, [currentSessionId, deleteSession, createSession, toast, t])

  useKeyboardShortcuts({
    newChat: (e) => {
      e.preventDefault()
      createSession()
      toast({ description: t("chat.shortcuts.new_chat_started") })
    },
    settings: (e) => {
      e.preventDefault()
      void openOptionsInTab()
    },
    toggleTheme: (e) => {
      e.preventDefault()
      const { theme, setTheme } = useThemeStore.getState()
      const nextTheme = theme === "dark" ? "light" : "dark"
      setTheme(nextTheme)
      toast({
        description: t(
          nextTheme === "dark"
            ? "chat.shortcuts.theme_dark"
            : "chat.shortcuts.theme_light"
        )
      })
    },
    toggleSpeech: (e) => {
      e.preventDefault()
      const lastAssistantMessage = [...messages]
        .reverse()
        .find((m) => m.role === "assistant")

      if (lastAssistantMessage) {
        toggleSpeech(lastAssistantMessage.content)
      }
    },
    searchMessages: (e) => {
      e.preventDefault()
      useSearchDialogStore.getState().openSearchDialog()
    },
    clearChat: (e) => {
      e.preventDefault()
      if (currentSessionId) setClearChatPending(true)
    },
    copyLastResponse: (e) => {
      e.preventDefault()
      const lastAssistantMessage = [...messages]
        .reverse()
        .find((m) => m.role === "assistant")
      if (lastAssistantMessage) {
        navigator.clipboard.writeText(lastAssistantMessage.content)
        toast({ description: t("chat.shortcuts.copied") })
      }
    },
    exportJson: (e) => {
      e.preventDefault()
      const session = sessions.find((s) => s.id === currentSessionId)
      if (session) {
        exportSessionAsJson(session)
        toast({ description: t("chat.shortcuts.exported_json") })
      }
    },
    exportPdf: (e) => {
      e.preventDefault()
      const session = sessions.find((s) => s.id === currentSessionId)
      if (session) {
        exportSessionAsPdf(session)
        toast({ description: t("chat.shortcuts.exported_pdf") })
      }
    }
  })
  return { clearChatPending, setClearChatPending, confirmClearChat }
}
