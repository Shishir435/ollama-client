import { defineContentScript } from "wxt/utils/define-content-script"

export default defineContentScript({
  matches: ["<all_urls>"],
  registration: "runtime",
  main() {
    return import("@/contents/index")
  }
})
