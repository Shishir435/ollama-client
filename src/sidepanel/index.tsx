import "../globals.css"

import { TooltipProvider } from "@/components/ui/tooltip"
import { useThemeWatcher } from "@/hooks/use-theme-watcher"
import Chat from "@/features/chat/components/chat"

function IndexSidePanel() {
  useThemeWatcher()
  return (
    <TooltipProvider>
      <Chat />
    </TooltipProvider>
  )
}

export default IndexSidePanel
