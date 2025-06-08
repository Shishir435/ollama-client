import {
  DEFAULT_MODEL_CONFIG,
  MESSAGE_KEYS,
  STORAGE_KEYS
} from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ModelConfigMap } from "@/types"

export {}

function isChromiumBased() {
  return (
    typeof chrome !== "undefined" &&
    typeof chrome.declarativeNetRequest !== "undefined"
  )
}

if (isChromiumBased() && "sidePanel" in chrome) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error("SidePanel error:", error))
}

if (!isChromiumBased()) {
  console.warn("DNR not available: skipping CORS workaround (likely Firefox)")
}

async function updateDNRRules() {
  const baseUrl =
    (await plasmoGlobalStorage.get(STORAGE_KEYS.OLLAMA.BASE_URL)) ??
    "http://localhost:11434"

  const origin = new URL(baseUrl).origin

  await chrome.declarativeNetRequest
    .updateDynamicRules({
      removeRuleIds: [1],
      addRules: [
        {
          id: 1,
          priority: 1,
          action: {
            type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
            requestHeaders: [
              {
                header: "Origin",
                operation: chrome.declarativeNetRequest.HeaderOperation.SET,
                value: origin
              }
            ]
          },
          condition: {
            urlFilter: `${origin}/*`,
            resourceTypes: [
              chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST
            ]
          }
        }
      ]
    })
    .catch(console.error)
}

if (isChromiumBased()) {
  chrome.runtime.onInstalled.addListener(updateDNRRules)
  chrome.runtime.onStartup.addListener(updateDNRRules)
}

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
        (await plasmoGlobalStorage.get<ModelConfigMap>(
          STORAGE_KEYS.OLLAMA.MODEL_CONFIGS
        )) ?? {}
      const modelParams = modelConfigMap[model] ?? DEFAULT_MODEL_CONFIG
      console.log("modelParams: ", modelParams)

      try {
        const requestBody = {
          model,
          messages,
          stream: true,
          ...modelParams
        }

        console.log(
          "🛰️ Sending to Ollama /api/chat:",
          JSON.stringify(requestBody, null, 2)
        )

        const response = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
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
        let buffer = ""

        while (true) {
          const { value, done } = await reader.read()
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

              // Handle streaming content
              if (data.message?.content) {
                const delta = data.message.content
                fullText += delta
                port.postMessage({ delta })
              }

              // Handle completion - when done is true, we get the final response with metrics
              if (data.done === true) {
                // Send the final message with metrics
                port.postMessage({
                  done: true,
                  content: fullText,
                  metrics: {
                    total_duration: data.total_duration,
                    load_duration: data.load_duration,
                    prompt_eval_count: data.prompt_eval_count,
                    prompt_eval_duration: data.prompt_eval_duration,
                    eval_count: data.eval_count,
                    eval_duration: data.eval_duration
                  }
                })
                return
              }
            } catch (err) {
              console.warn("Failed to parse chunk line:", trimmedLine, err)
            }
          }
        }

        // Process any remaining data in buffer
        if (buffer.trim()) {
          try {
            const data = JSON.parse(buffer.trim())
            if (data.done === true) {
              port.postMessage({
                done: true,
                content: fullText,
                metrics: {
                  total_duration: data.total_duration,
                  load_duration: data.load_duration,
                  prompt_eval_count: data.prompt_eval_count,
                  prompt_eval_duration: data.prompt_eval_duration,
                  eval_count: data.eval_count,
                  eval_duration: data.eval_duration
                }
              })
            }
          } catch (parseError) {
            console.warn("Failed to parse final buffer:", buffer, parseError)
          }
        }
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
  switch (message.type) {
    case MESSAGE_KEYS.OLLAMA.GET_MODELS: {
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

    case MESSAGE_KEYS.OLLAMA.SHOW_MODEL_DETAILS: {
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

    case MESSAGE_KEYS.BROWSER.OPEN_TAB: {
      chrome.tabs.query({}, (tabs) => {
        console.log(tabs)
        sendResponse({ tabs })
      })
      return true
    }

    case MESSAGE_KEYS.OLLAMA.SCRAPE_MODEL: {
      if (message.query) {
        fetch(
          `https://ollama.com/search?q=${encodeURIComponent(message.query)}`
        )
          .then((res) => res.text())
          .then((html) => {
            sendResponse({ html })
          })
          .catch((err) => {
            sendResponse({ error: err.message })
          })
        return true
      }
      break
    }

    case MESSAGE_KEYS.OLLAMA.SCRAPE_MODEL_VARIANTS: {
      if (message.name) {
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
      break
    }

    case MESSAGE_KEYS.OLLAMA.UPDATE_BASE_URL: {
      try {
        const origin = new URL(message.payload).origin

        chrome.declarativeNetRequest
          .updateDynamicRules({
            removeRuleIds: [1],
            addRules: [
              {
                id: 1,
                priority: 1,
                action: {
                  type: chrome.declarativeNetRequest.RuleActionType
                    .MODIFY_HEADERS,
                  requestHeaders: [
                    {
                      header: "Origin",
                      operation:
                        chrome.declarativeNetRequest.HeaderOperation.SET,
                      value: origin
                    }
                  ]
                },
                condition: {
                  urlFilter: `${origin}/*`,
                  resourceTypes: [
                    chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST
                  ]
                }
              }
            ]
          })
          .then(() => sendResponse({ success: true }))
          .catch((err) => sendResponse({ success: false, error: err.message }))
      } catch (err) {
        sendResponse({ success: false, error: err.message })
      }
      return true
    }
  }
})
