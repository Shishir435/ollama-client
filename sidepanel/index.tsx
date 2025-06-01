import { SelectedTabsProvider } from "@/context/selected-tab-ids-context"

import "../globals.css"

import Chat from "@/components/chat"
import { ThemeProvider } from "@/components/them-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ChatInputProvider } from "@/context/chat-input-context"
import { LoadStreamProvider } from "@/context/load-stream-context"
import { TabContentContextProvider } from "@/context/tab-content-context"
import { STORAGE_KEYS } from "@/lib/constant"

function IndexSidePanel() {
  return (
    <ThemeProvider storageKey={STORAGE_KEYS.THEME.PREFERENCE}>
      <TooltipProvider>
        <LoadStreamProvider>
          <ChatInputProvider>
            <SelectedTabsProvider>
              <TabContentContextProvider>
                <Chat />
              </TabContentContextProvider>
            </SelectedTabsProvider>
          </ChatInputProvider>
        </LoadStreamProvider>
      </TooltipProvider>
    </ThemeProvider>
  )
}

export default IndexSidePanel
