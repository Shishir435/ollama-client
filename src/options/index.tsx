import { useStorage } from "@plasmohq/storage/hook"
import { ErrorBoundary } from "@/components/ui/error-boundary"
import { TooltipProvider } from "@/components/ui/tooltip"
import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { OllamaOptions } from "@/options/components/ollama-options"
import "../globals.css"
import "@/i18n/config"

import { useSessionMetricsPreference } from "@/features/chat/hooks/use-session-metrics-preference"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { useLanguageSync } from "@/hooks/use-language-sync"
import { useThemeWatcher } from "@/hooks/use-theme-watcher"
import { useThemeStore } from "@/stores/theme"

export const OptionsIndex = () => {
  useThemeWatcher()
  useLanguageSync()

  const [showSessionMetrics, setShowSessionMetrics] =
    useSessionMetricsPreference()

  const [useRAG, setUseRAG] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.USE_RAG,
      instance: plasmoGlobalStorage
    },
    true
  )

  const [tabAccess, setTabAccess] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.BROWSER.TABS_ACCESS,
      instance: plasmoGlobalStorage
    },
    false
  )

  useKeyboardShortcuts({
    toggleTheme: (e) => {
      e.preventDefault()
      const { theme, setTheme } = useThemeStore.getState()
      const nextTheme = theme === "dark" ? "light" : "dark"
      setTheme(nextTheme)
    },
    toggleSessionMetrics: (e) => {
      e.preventDefault()
      setShowSessionMetrics(!showSessionMetrics)
    },
    toggleRAG: (e) => {
      e.preventDefault()
      setUseRAG(!useRAG)
    },
    toggleTabs: (e) => {
      e.preventDefault()
      setTabAccess(!tabAccess)
    },
    toggleSpeech: (e) => {
      e.preventDefault()
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel()
      }
    }
  })

  return (
    <ErrorBoundary>
      <TooltipProvider>
        <OllamaOptions />
      </TooltipProvider>
    </ErrorBoundary>
  )
}

export default OptionsIndex
