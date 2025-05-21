import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constant"

import { Storage } from "@plasmohq/storage"

export {}

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.log(error))

console.log("hello ji ")

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const storage = new Storage()

  if (message.type === MESSAGE_KEYS.OLLAMA.GET_MODELS) {
    storage.get(STORAGE_KEYS.OLLAMA.BASE_URL).then((url) => {
      const OllamaBaseUrl = url ?? "http://localhost:11434"
      console.log("Ollama URL:", OllamaBaseUrl)
      fetch(`${OllamaBaseUrl}/api/tags`)
        .then((res) => {
          if (!res.ok)
            throw new Error(`Failed to fetch models: ${res.statusText}`)
          return res.json()
        })
        .then((data) => {
          console.log("List of available models", data)
          sendResponse({ success: true, data })
        })
        .catch((err) => sendResponse({ success: false, error: err.message }))
    })
    return true
  }

  if (message.type === MESSAGE_KEYS.OLLAMA.CHAT_WITH_MODEL) {
    const { model, messages } = message.payload

    storage.get(STORAGE_KEYS.OLLAMA.BASE_URL).then(async (url) => {
      const OllamaBaseUrl = url ?? "http://localhost:11434"

      try {
        const chatResponse = await fetch(
          `${OllamaBaseUrl}/v1/chat/completions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "omit",
            mode: "cors",
            body: JSON.stringify({ model, messages, stream: false })
          }
        )
        console.log(model, message, chatResponse)
        if (!chatResponse.ok) {
          const errorText = await chatResponse.text()
          throw new Error(
            `Chat failed: HTTP ${chatResponse.status} - ${errorText}`
          )
        }

        const data = await chatResponse.json()
        console.log("Chat response received", data)
        sendResponse({ success: true, data })
      } catch (err) {
        console.error("Error:", err.message)
        sendResponse({ success: false, error: err.message })
      }
    })

    return true
  }
})
