import { SelectedTabsProvider } from "@/context/selected-tab-ids-context"

import "../globals.css"

import Chat from "@/components/chat"
import { ChatInputProvider } from "@/context/chat-input-context"
import { TabContentContextProvider } from "@/context/tab-context-context"

function IndexSidePanel() {
  return (
    <ChatInputProvider>
      <SelectedTabsProvider>
        <TabContentContextProvider>
          <Chat />
        </TabContentContextProvider>
      </SelectedTabsProvider>
    </ChatInputProvider>
  )
}

export default IndexSidePanel
