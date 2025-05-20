import ModelMenu from "@/components/model-menu"

import "../globals.css"

function IndexSidePanel() {
  return (
    <div style={{ display: "flex", flexDirection: "column", padding: 16 }}>
      <ModelMenu />
    </div>
  )
}

export default IndexSidePanel
