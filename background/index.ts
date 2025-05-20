import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constant"

import { Storage } from "@plasmohq/storage"

export {}
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.log(error))

console.log("hello ji ")

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MESSAGE_KEYS.OLLAMA.GET_MODELS) {
    const storage = new Storage()
    storage.get(STORAGE_KEYS.OLLAMA.BASE_URL).then((url) => {
      const OllamaBaseUrl = url ?? "http://localhost:11434"
      console.log("Ollama URL:", url)
      fetch(`${OllamaBaseUrl}/api/tags`)
        .then((res) => res.json())
        .then((data) => {
          console.log(data)
          sendResponse({ success: true, data })
        })
        .catch((err) => sendResponse({ success: false, error: err.message }))
    })
    return true
  }
})
