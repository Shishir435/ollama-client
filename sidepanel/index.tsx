import { SelectedTabsProvider } from "@/context/selected-tab-ids-context"

import "../globals.css"

import Chat from "@/components/chat"
import { ChatInputProvider } from "@/context/chat-input-context"
import { LoadStreamProvider } from "@/context/load-stream-context"
import { TabContentContextProvider } from "@/context/tab-context-context"

function IndexSidePanel() {
  return (
    <LoadStreamProvider>
      <ChatInputProvider>
        <SelectedTabsProvider>
          <TabContentContextProvider>
            <Chat />
          </TabContentContextProvider>
        </SelectedTabsProvider>
      </ChatInputProvider>
    </LoadStreamProvider>
  )
}

export default IndexSidePanel
