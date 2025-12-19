import { useSpeechSynthesis } from "@/features/chat/hooks/use-speech-synthesis"
import { useChatExport } from "@/features/sessions/hooks/use-export-chat"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { useToast } from "@/hooks/use-toast"
import browser from "@/lib/browser-api"
import { useSearchDialogStore } from "@/stores/search-dialog-store"
import { useThemeStore } from "@/stores/theme"
import type { ChatMessage } from "@/types"

interface UseChatKeyboardShortcutsParams {
  messages: ChatMessage[]
  currentSessionId: string | null
  createSession: () => void
  deleteSession: (id: string) => void
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
  const { toggle: toggleSpeech } = useSpeechSynthesis()
  const { toast } = useToast()
  const { sessions } = useChatSessions()
  const {
    exportSessionAsJson,
    exportSessionAsMarkdown,
    exportSessionAsPdf,
    exportSessionAsText
  } = useChatExport()

  useKeyboardShortcuts({
    newChat: (e) => {
      e.preventDefault()
      createSession()
      toast({ description: "Started new chat session" })
    },
    settings: (e) => {
      e.preventDefault()
      browser.runtime.openOptionsPage()
    },
    toggleTheme: (e) => {
      e.preventDefault()
      const { theme, setTheme } = useThemeStore.getState()
      const nextTheme = theme === "dark" ? "light" : "dark"
      setTheme(nextTheme)
      toast({ description: `Switched to ${nextTheme} mode` })
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
      if (currentSessionId && confirm("Clear this chat session?")) {
        deleteSession(currentSessionId)
        createSession()
        toast({ description: "Chat session cleared" })
      }
    },
    copyLastResponse: (e) => {
      e.preventDefault()
      const lastAssistantMessage = [...messages]
        .reverse()
        .find((m) => m.role === "assistant")
      if (lastAssistantMessage) {
        navigator.clipboard.writeText(lastAssistantMessage.content)
        toast({ description: "Copied to clipboard" })
      }
    },
    exportJson: (e) => {
      e.preventDefault()
      const session = sessions.find((s) => s.id === currentSessionId)
      if (session) {
        exportSessionAsJson(session)
        toast({ description: "Chat exported as JSON" })
      }
    },
    exportMarkdown: (e) => {
      e.preventDefault()
      const session = sessions.find((s) => s.id === currentSessionId)
      if (session) {
        exportSessionAsMarkdown(session)
        toast({ description: "Chat exported as Markdown" })
      }
    },
    exportPdf: (e) => {
      e.preventDefault()
      const session = sessions.find((s) => s.id === currentSessionId)
      if (session) {
        exportSessionAsPdf(session)
        toast({ description: "Chat exported as PDF" })
      }
    },
    exportText: (e) => {
      e.preventDefault()
      const session = sessions.find((s) => s.id === currentSessionId)
      if (session) {
        exportSessionAsText(session)
        toast({ description: "Chat exported as Text" })
      }
    }
  })
}
