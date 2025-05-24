import { SelectedTabsProvider } from "@/context/selected-tab-context"

import "../globals.css"

import Chat from "@/components/chat"

function IndexSidePanel() {
  return (
    <SelectedTabsProvider>
      <Chat />
    </SelectedTabsProvider>
  )
}

export default IndexSidePanel
