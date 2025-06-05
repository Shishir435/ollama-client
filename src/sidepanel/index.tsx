import { SelectedTabsProvider } from "@/features/tabs/context/selected-tab-ids-context"

import "../globals.css"

import { TooltipProvider } from "@/components/ui/tooltip"
import { LoadStreamProvider } from "@/context/load-stream-context"
import { ThemeProvider } from "@/context/them-provider-context"
import { STORAGE_KEYS } from "@/lib/constants"
import Chat from "@/features/chat/components/chat"
import { ChatInputProvider } from "@/features/chat/context/chat-input-context"
import { ChatSessionProvider } from "@/features/sessions/context/chat-session-context"
import { TabContentContextProvider } from "@/features/tabs/context/tab-content-context"

function IndexSidePanel() {
  return (
    <ThemeProvider storageKey={STORAGE_KEYS.THEME.PREFERENCE}>
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
    </ThemeProvider>
  )
}

export default IndexSidePanel
