import { createRoot, type Root } from "react-dom/client"
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root"
import { defineContentScript } from "wxt/utils/define-content-script"

import SelectionButton from "@/contents/selection-button"
import "@/globals.css"

export default defineContentScript({
  matches: ["<all_urls>"],
  allFrames: true,
  cssInjectionMode: "ui",
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: "provider-selection-button",
      position: "inline",
      anchor: "body",
      append: "last",
      onMount: (uiContainer) => {
        const app = document.createElement("div")
        uiContainer.append(app)

        const root = createRoot(app)
        root.render(<SelectionButton />)
        return root
      },
      onRemove: (root?: Root) => {
        root?.unmount()
      }
    })

    ui.mount()
  }
})
