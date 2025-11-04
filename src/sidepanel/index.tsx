import "../globals.css"

import { TooltipProvider } from "@/components/ui/tooltip"
import { Chat } from "@/features/chat/components/chat"
import { useThemeWatcher } from "@/hooks/use-theme-watcher"

const IndexSidePanel = () => {
  useThemeWatcher()
  return (
    <TooltipProvider>
      <Chat />
    </TooltipProvider>
  )
}

export default IndexSidePanel
