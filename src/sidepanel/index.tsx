import "../globals.css"
import "@/i18n/config"

import { QueryClientProvider } from "@tanstack/react-query"
import { ErrorBoundary } from "@/components/ui/error-boundary"
import { Toaster } from "@/components/ui/toaster"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Chat } from "@/features/chat/components/chat"
import { useEmbeddingMigration } from "@/features/chat/hooks/use-embedding-migration"
import { useLanguageSync } from "@/hooks/use-language-sync"
import { useProviderStorageMigration } from "@/hooks/use-provider-storage-migration"
import { useSQLiteMigration } from "@/hooks/use-sqlite-migration"
import { useThemeWatcher } from "@/hooks/use-theme-watcher"
import { queryClient } from "@/lib/query-client"

const IndexSidePanel = () => {
  useThemeWatcher()
  useLanguageSync()
  useEmbeddingMigration()
  useProviderStorageMigration()
  useSQLiteMigration() // Automatic SQLite migration
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <TooltipProvider>
          <Chat />
          <Toaster />
        </TooltipProvider>
      </ErrorBoundary>
    </QueryClientProvider>
  )
}

export default IndexSidePanel
