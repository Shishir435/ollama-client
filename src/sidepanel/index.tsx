import { SelectedTabsProvider } from "@/features/tabs/context/selected-tab-ids-context"

import "../globals.css"

import { TooltipProvider } from "@/components/ui/tooltip"
import { useThemeWatcher } from "@/hooks/use-theme-watcher"
import Chat from "@/features/chat/components/chat"
import { TabContentContextProvider } from "@/features/tabs/context/tab-content-context"

function IndexSidePanel() {
  useThemeWatcher()
  return (
    <TooltipProvider>
      <SelectedTabsProvider>
        <TabContentContextProvider>
          <Chat />
        </TabContentContextProvider>
      </SelectedTabsProvider>
    </TooltipProvider>
  )
}

export default IndexSidePanel
