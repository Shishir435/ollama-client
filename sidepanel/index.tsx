import ModelMenu from "@/components/model-menu"

import "../globals.css"

import Chat from "@/components/chat"

function IndexSidePanel() {
  return (
    <div style={{ display: "flex", flexDirection: "column", padding: 16 }}>
      <ModelMenu />
      <Chat />
    </div>
  )
}

export default IndexSidePanel
