import "../globals.css"
import "@/i18n/config"

import { ErrorBoundary } from "@/components/ui/error-boundary"
import { Toaster } from "@/components/ui/toaster"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Chat } from "@/features/chat/components/chat"
import { useEmbeddingMigration } from "@/features/chat/hooks/use-embedding-migration"
import { useLanguageSync } from "@/hooks/use-language-sync"
import { useThemeWatcher } from "@/hooks/use-theme-watcher"

const IndexSidePanel = () => {
  useThemeWatcher()
  useLanguageSync()
  useEmbeddingMigration()
  return (
    <ErrorBoundary>
      <TooltipProvider>
        <Chat />
        <Toaster />
      </TooltipProvider>
    </ErrorBoundary>
  )
}

export default IndexSidePanel
