import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constant"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

export {}

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("SidePanel error:", error))

let abortController: AbortController | null = null
const pullAbortControllers: Record<string, AbortController> = {}

chrome.runtime.onConnect.addListener((port) => {
  port.onMessage.addListener(async (msg) => {
    if (msg.type === MESSAGE_KEYS.OLLAMA.CHAT_WITH_MODEL) {
      const { model, messages } = msg.payload
      const baseUrl =
        (await plasmoGlobalStorage.get(STORAGE_KEYS.OLLAMA.BASE_URL)) ??
        "http://localhost:11434"

      abortController = new AbortController()
      const modelConfigMap =
        (await plasmoGlobalStorage.get(STORAGE_KEYS.OLLAMA.MODEL_CONFIGS)) ?? {}
      const modelParams = modelConfigMap[model] ?? {}
      console.log(modelParams)

      try {
        const response = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            stream: true,
            ...modelParams
          }),
          signal: abortController.signal
        })

        if (!response.ok || !response.body) {
          port.postMessage({
            error: {
              status: response.status,
              message: response.statusText
            }
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
          port.postMessage({
            error: {
              status: 0,
              messages: err.message
            }
          })
        }
      }
    }
    if (msg.type === MESSAGE_KEYS.OLLAMA.STOP_GENERATION) {
      abortController?.abort()
    }
  })
  if (port.name === MESSAGE_KEYS.OLLAMA.PULL_MODEL) {
    port.onMessage.addListener(async (msg) => {
      const modelName = msg.payload
      if (msg.cancel) {
        pullAbortControllers[modelName]?.abort()
        delete pullAbortControllers[modelName]
        return
      }
      const baseUrl =
        (await plasmoGlobalStorage.get(STORAGE_KEYS.OLLAMA.BASE_URL)) ??
        "http://localhost:11434"

      const controller = new AbortController()
      pullAbortControllers[modelName] = controller

      try {
        const res = await fetch(`${baseUrl}/api/pull`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: modelName }),
          signal: controller.signal
        })

        if (!res.ok) {
          port.postMessage({
            error: { status: res.status, message: res.statusText }
          })
          return
        }

        if (!res.body) {
          port.postMessage({ error: "No response body received" })
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder("utf-8")
        let buffer = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          // Accumulate chunks in buffer
          buffer += decoder.decode(value, { stream: true })

          // Process complete lines
          const lines = buffer.split("\n")
          // Keep the last incomplete line in buffer
          buffer = lines.pop() || ""

          for (const line of lines) {
            const trimmedLine = line.trim()
            if (!trimmedLine) continue

            try {
              const data = JSON.parse(trimmedLine)

              // Handle different response types from Ollama
              if (data.status) {
                port.postMessage({ status: data.status })

                // Check for completion - Ollama returns "success" when done
                if (data.status === "success") {
                  port.postMessage({ done: true })
                  delete pullAbortControllers[modelName]
                  return
                }
              }

              // Handle error responses
              if (data.error) {
                port.postMessage({ error: data.error })
                delete pullAbortControllers[modelName]
                return
              }

              // Handle progress updates (downloading, verifying, etc.)
              if (data.completed !== undefined && data.total !== undefined) {
                const progress = Math.round((data.completed / data.total) * 100)
                port.postMessage({
                  status: `Downloading: ${progress}%`,
                  progress: progress
                })
              }
            } catch (parseError) {
              console.warn("Failed to parse line:", trimmedLine, parseError)
              // Don't send error for parse failures, just log and continue
            }
          }
        }

        // Process any remaining data in buffer
        if (buffer.trim()) {
          try {
            const data = JSON.parse(buffer.trim())
            if (data.status === "success") {
              port.postMessage({ done: true })
            }
          } catch (parseError) {
            console.warn("Failed to parse final buffer:", buffer, parseError)
          }
        }
        delete pullAbortControllers[modelName]
      } catch (err) {
        if (err.name === "AbortError") {
          port.postMessage({ error: "Download cancelled" })
        } else {
          port.postMessage({
            error: { status: 0, message: err.message || "Failed to pull model" }
          })
        }
      }
    })
  }
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MESSAGE_KEYS.OLLAMA.GET_MODELS) {
    plasmoGlobalStorage.get(STORAGE_KEYS.OLLAMA.BASE_URL).then((url) => {
      const OllamaBaseUrl = url ?? "http://localhost:11434"
      fetch(`${OllamaBaseUrl}/api/tags`)
        .then((res) => {
          if (!res.ok) {
            sendResponse({
              success: false,
              error: { status: res.status, message: res.statusText }
            })
            return
          }
          // throw new Error(`Failed to fetch models: ${res.statusText}`)
          return res.json()
        })
        .then((data) => {
          sendResponse({ success: true, data })
        })
        .catch((err) =>
          sendResponse({
            success: false,
            error: { status: 0, message: err.message }
          })
        )
    })
    return true
  }

  if (message.type === MESSAGE_KEYS.OLLAMA.SHOW_MODEL_DETAILS) {
    const model = message.payload
    plasmoGlobalStorage.get(STORAGE_KEYS.OLLAMA.BASE_URL).then((url) => {
      const baseUrl = url ?? "http://localhost:11434"
      fetch(`${baseUrl}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: model })
      })
        .then(async (res) => {
          if (!res.ok) {
            sendResponse({
              success: false,
              error: { status: res.status, message: res.statusText }
            })
            return
          }
          const data = await res.json()

          sendResponse({ success: true, data })
        })
        .catch((err) => {
          sendResponse({
            success: false,
            error: { status: 0, message: err.message }
          })
        })
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
  if (message.type === MESSAGE_KEYS.OLLAMA.SCRAPE_MODEL && message.query) {
    fetch(`https://ollama.com/search?q=${encodeURIComponent(message.query)}`)
      .then((res) => res.text())
      .then((html) => {
        sendResponse({ html })
      })
      .catch((err) => {
        sendResponse({ error: err.message })
      })
    return true
  }

  if (
    message.type === MESSAGE_KEYS.OLLAMA.SCRAPE_MODEL_VARIANTS &&
    message.name
  ) {
    fetch(`https://ollama.com/library/${encodeURIComponent(message.name)}`)
      .then((res) => res.text())
      .then((html) => {
        sendResponse({ html })
      })
      .catch((err) => {
        sendResponse({ error: err.message })
      })
    return true
  }
})
