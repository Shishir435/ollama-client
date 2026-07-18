import "../extension-fonts.css"
import "../globals.css"
import "@/i18n/config"

import { QueryClientProvider } from "@tanstack/react-query"
import { useEffect } from "react"
import { browser } from "wxt/browser"
import { DevThemePane } from "@/components/dev-theme-pane"
import { ErrorBoundary } from "@/components/ui/error-boundary"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Chat } from "@/features/chat/components/chat"
import { useEmbeddingMigration } from "@/features/chat/hooks/use-embedding-migration"
import { useLanguageSync } from "@/hooks/use-language-sync"
import { useProviderStorageMigration } from "@/hooks/use-provider-storage-migration"
import { useThemeWatcher } from "@/hooks/use-theme-watcher"
import { queryClient } from "@/lib/query-client"
import { FirstRunPermissionsDialog } from "@/sidepanel/components/first-run-permissions-dialog"
import { createSidepanelRuntimeMessageListener } from "@/sidepanel/runtime-message-listener"

const IndexSidePanel = () => {
  useThemeWatcher()
  useLanguageSync()
  useEmbeddingMigration()
  useProviderStorageMigration()

  useEffect(() => {
    const listener = createSidepanelRuntimeMessageListener()
    browser.runtime.onMessage.addListener(listener)
    return () => browser.runtime.onMessage.removeListener(listener)
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <TooltipProvider>
          <Chat />
          <FirstRunPermissionsDialog />
          <DevThemePane />
          <Toaster position={"top-center"} closeButton={true} />
        </TooltipProvider>
      </ErrorBoundary>
    </QueryClientProvider>
  )
}

export default IndexSidePanel
