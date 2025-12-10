import { useSpeechSynthesis } from "@/features/chat/hooks/use-speech-synthesis"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
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

  useKeyboardShortcuts({
    newChat: (e) => {
      e.preventDefault()
      createSession()
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
      }
    },
    copyLastResponse: (e) => {
      e.preventDefault()
      const lastAssistantMessage = [...messages]
        .reverse()
        .find((m) => m.role === "assistant")
      if (lastAssistantMessage) {
        navigator.clipboard.writeText(lastAssistantMessage.content)
      }
    }
  })
}
