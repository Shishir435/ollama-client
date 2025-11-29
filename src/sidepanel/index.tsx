import "../globals.css"
import "@/i18n/config"

import { TooltipProvider } from "@/components/ui/tooltip"
import { Chat } from "@/features/chat/components/chat"
import { useLanguageSync } from "@/hooks/use-language-sync"
import { useThemeWatcher } from "@/hooks/use-theme-watcher"

const IndexSidePanel = () => {
  useThemeWatcher()
  useLanguageSync()
  return (
    <TooltipProvider>
      <Chat />
    </TooltipProvider>
  )
}

export default IndexSidePanel
