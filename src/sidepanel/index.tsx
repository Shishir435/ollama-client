import { SelectedTabsProvider } from "@/features/tabs/context/selected-tab-ids-context"

import "../globals.css"

import { TooltipProvider } from "@/components/ui/tooltip"
import { useThemeWatcher } from "@/hooks/use-theme-watcher"
import { LoadStreamProvider } from "@/context/load-stream-context"
import Chat from "@/features/chat/components/chat"
import { ChatInputProvider } from "@/features/chat/context/chat-input-context"
import { ChatSessionProvider } from "@/features/sessions/context/chat-session-context"
import { TabContentContextProvider } from "@/features/tabs/context/tab-content-context"

function IndexSidePanel() {
  useThemeWatcher()
  return (
    <TooltipProvider>
      <ChatSessionProvider>
        <LoadStreamProvider>
          <ChatInputProvider>
            <SelectedTabsProvider>
              <TabContentContextProvider>
                <Chat />
              </TabContentContextProvider>
            </SelectedTabsProvider>
          </ChatInputProvider>
        </LoadStreamProvider>
      </ChatSessionProvider>
    </TooltipProvider>
  )
}

export default IndexSidePanel
