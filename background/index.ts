import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constant"

import { Storage } from "@plasmohq/storage"

export {}

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("SidePanel error:", error))

let abortController: AbortController | null = null

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== MESSAGE_KEYS.OLLAMA.STREAM_RESPONSE) return

  port.onMessage.addListener(async (msg) => {
    if (msg.type === MESSAGE_KEYS.OLLAMA.CHAT_WITH_MODEL) {
      const { model, messages } = msg.payload
      const storage = new Storage()
      const baseUrl =
        (await storage.get(STORAGE_KEYS.OLLAMA.BASE_URL)) ??
        "http://localhost:11434"

      abortController = new AbortController()

      try {
        const response = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            stream: true
          }),
          signal: abortController.signal
        })

        if (!response.ok || !response.body) {
          port.postMessage({
            error: `HTTP ${response.status}: ${response.statusText}`
          })
          return
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder("utf-8")
        let fullText = ""

        while (true) {
          const { value, done } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })

          // Process each line starting with 'data:'
          const lines = chunk
            .split("\n")
            .filter((line) => line.trim().startsWith("data:"))
          for (const line of lines) {
            const jsonStr = line.replace("data: ", "").trim()
            if (jsonStr === "[DONE]") continue

            try {
              const data = JSON.parse(jsonStr)
              const delta = data.choices?.[0]?.delta?.content || ""
              fullText += delta
              port.postMessage({ delta })
            } catch (err) {
              console.warn("Failed to parse chunk line:", line)
            }
          }
        }

        port.postMessage({ done: true, content: fullText })
      } catch (err) {
        if (err.name === "AbortError") {
          port.postMessage({ done: true, aborted: true })
        } else {
          console.error("Streaming error:", err.message)
          port.postMessage({ error: err.message })
        }
      }
    }
    if (msg.type === MESSAGE_KEYS.OLLAMA.STOP_GENERATION) {
      abortController?.abort()
    }
  })
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const storage = new Storage()

  if (message.type === MESSAGE_KEYS.OLLAMA.GET_MODELS) {
    storage.get(STORAGE_KEYS.OLLAMA.BASE_URL).then((url) => {
      const OllamaBaseUrl = url ?? "http://localhost:11434"
      fetch(`${OllamaBaseUrl}/api/tags`)
        .then((res) => {
          if (!res.ok)
            throw new Error(`Failed to fetch models: ${res.statusText}`)
          return res.json()
        })
        .then((data) => {
          sendResponse({ success: true, data })
        })
        .catch((err) => sendResponse({ success: false, error: err.message }))
    })
    return true
  }
  if (message.type === MESSAGE_KEYS.BROWSER.OPEN_TAB) {
    chrome.tabs.query({}, (tabs) => {
      console.log(tabs)
      sendResponse({ tabs })
    })
    return true
  }
})
