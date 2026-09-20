import { defineContentScript } from "wxt/utils/define-content-script"

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  registration: "runtime",
  main() {
    return import("@/contents/agent-control")
  }
})
