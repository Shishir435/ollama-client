import {
  DEFAULT_MODEL_CONFIG,
  MESSAGE_KEYS,
  STORAGE_KEYS
} from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type {
  AbortControllerMap,
  ChatMessage,
  ChatStreamMessage,
  ChatWithModelMessage,
  ChromeMessage,
  ChromePort,
  ChromeResponse,
  ModelConfigMap,
  ModelPullMessage,
  NetworkError,
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaPullRequest,
  OllamaPullResponse,
  OllamaShowRequest,
  OllamaShowResponse,
  OllamaTagsResponse,
  PortStatusFunction,
  PullStreamMessage,
  SendResponseFunction,
  StreamChunkResult
} from "@/types"

export {}

// Global state
let abortController: AbortController | null = null
const pullAbortControllers: AbortControllerMap = {}

// Initialize side panel and DNR rules
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error: Error) => console.error("SidePanel error:", error))

chrome.runtime.onInstalled.addListener(updateDNRRules)
chrome.runtime.onStartup.addListener(updateDNRRules)

function safePostMessage(
  port: ChromePort,
  message: ChatStreamMessage | PullStreamMessage
): void {
  try {
    port.postMessage(message)
  } catch (error) {
    console.warn("Failed to send message to port:", (error as Error).message)
  }
}

// Update declarative net request rules for CORS
async function updateDNRRules(): Promise<void> {
  try {
    const baseUrl =
      ((await plasmoGlobalStorage.get(
        STORAGE_KEYS.OLLAMA.BASE_URL
      )) as string) ?? "http://localhost:11434"

    const origin = new URL(baseUrl).origin

    await chrome.declarativeNetRequest.updateDynamicRules({
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
  } catch (error) {
    console.error("Failed to update DNR rules:", error)
  }
}

// Limit message history for smaller models to prevent context overflow
function limitMessagesForModel(
  model: string,
  messages: ChatMessage[]
): ChatMessage[] {
  if (model.includes("135m") || model.includes("0.6b")) {
    return messages.slice(-5) // Only last 5 messages for small models
  }
  return messages
}

// Handle streaming response from Ollama chat API
async function handleChatStream(
  response: Response,
  port: ChromePort,
  isPortClosed: PortStatusFunction
): Promise<void> {
  if (!response.body) {
    console.error("No response body received")
    safePostMessage(port, {
      error: {
        status: 0,
        message: "No response from model - try regenerating"
      }
    })
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder("utf-8")
  let fullText = ""
  let buffer = ""
  let hasReceivedData = false

  // Add timeout for stuck connections - declare timeoutId in proper scope
  let timeoutId: NodeJS.Timeout | null = null

  try {
    timeoutId = setTimeout(() => {
      if (!hasReceivedData) {
        console.warn("No data received within 10 seconds, aborting")
        reader.cancel().catch(console.error)
        safePostMessage(port, {
          error: {
            status: 0,
            message: "Request timeout - try regenerating"
          }
        })
      }
    }, 10000) // 10 second timeout

    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        if (timeoutId) clearTimeout(timeoutId)
        break
      }

      // Mark that we've received data
      if (!hasReceivedData) {
        hasReceivedData = true
        if (timeoutId) clearTimeout(timeoutId)
        console.log("First data chunk received")
      }

      // Check if port is still connected before processing
      if (isPortClosed()) {
        reader.cancel().catch(console.error)
        if (timeoutId) clearTimeout(timeoutId)
        break
      }

      // Process the streaming data
      const processResult = processStreamChunk(
        value,
        decoder,
        buffer,
        fullText,
        port
      )
      buffer = processResult.buffer
      fullText = processResult.fullText

      if (processResult.isDone) {
        if (timeoutId) clearTimeout(timeoutId)
        return
      }
    }

    // Process any remaining data in buffer
    if (buffer.trim() && !isPortClosed()) {
      processRemainingBuffer(buffer, fullText, port)
    }
  } catch (error) {
    console.error("Stream processing error:", error)
    throw error
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

// Process individual stream chunks
function processStreamChunk(
  value: Uint8Array,
  decoder: TextDecoder,
  buffer: string,
  fullText: string,
  port: ChromePort
): StreamChunkResult {
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
      const data: OllamaChatResponse = JSON.parse(trimmedLine)

      // Handle streaming content
      if (data.message?.content) {
        const delta = data.message.content
        fullText += delta
        safePostMessage(port, { delta })
      }

      // Handle completion - when done is true, we get the final response with metrics
      if (data.done === true) {
        console.log("Generation completed, total tokens:", fullText.length)
        // Send the final message with metrics
        safePostMessage(port, {
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
        return { buffer, fullText, isDone: true }
      }
    } catch (err) {
      const error = err as Error
      console.warn("Failed to parse chunk line:", trimmedLine, error)
      // If we can't parse multiple chunks, the connection might be corrupted
      if (error.name === "SyntaxError") {
        console.warn(
          "Multiple parse errors detected, connection may be corrupted"
        )
      }
    }
  }

  return { buffer, fullText, isDone: false }
}

// Process remaining buffer data
function processRemainingBuffer(
  buffer: string,
  fullText: string,
  port: ChromePort
): void {
  try {
    const data: OllamaChatResponse = JSON.parse(buffer.trim())
    if (data.done === true) {
      console.log("Final completion from buffer")
      safePostMessage(port, {
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

// Handle chat with model request
async function handleChatWithModel(
  msg: ChatWithModelMessage,
  port: ChromePort,
  isPortClosed: PortStatusFunction
): Promise<void> {
  const { model, messages } = msg.payload
  const baseUrl =
    ((await plasmoGlobalStorage.get(STORAGE_KEYS.OLLAMA.BASE_URL)) as string) ??
    "http://localhost:11434"

  abortController = new AbortController()
  const modelConfigMap =
    (await plasmoGlobalStorage.get<ModelConfigMap>(
      STORAGE_KEYS.OLLAMA.MODEL_CONFIGS
    )) ?? {}
  const modelParams = modelConfigMap[model] ?? DEFAULT_MODEL_CONFIG
  console.log("modelParams: ", model, modelParams)

  try {
    console.log("Starting request for model:", model)
    console.log("Request payload size:", messages.length, "messages")

    const limitedMessages = limitMessagesForModel(model, messages)

    const requestBody: OllamaChatRequest = {
      model,
      messages: limitedMessages,
      stream: true,
      ...modelParams
    }

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: abortController.signal
    })

    console.log("Response status:", response.status, response.statusText)

    if (!response.ok) {
      console.error("Response not OK:", response.status, response.statusText)
      safePostMessage(port, {
        error: {
          status: response.status,
          message: response.statusText
        }
      })
      return
    }

    await handleChatStream(response, port, isPortClosed)
  } catch (err) {
    const error = err as NetworkError
    console.error("Request error:", error.name, error.message)

    if (error.name === "AbortError") {
      console.log("Request aborted by user")
      // Only send abort message if port is still connected
      if (!isPortClosed()) {
        safePostMessage(port, { done: true, aborted: true })
      }
    } else {
      console.error("Streaming error:", error.message)
      safePostMessage(port, {
        error: {
          status: error.status ?? 0,
          message: error.message || "Unknown error occurred - try regenerating"
        }
      })
    }
  }
}

// Handle model pulling with streaming progress
async function handleModelPull(
  msg: ModelPullMessage,
  port: ChromePort,
  isPortClosed: PortStatusFunction
): Promise<void> {
  const modelName = msg.payload
  if (msg.cancel) {
    pullAbortControllers[modelName]?.abort()
    delete pullAbortControllers[modelName]
    return
  }

  const baseUrl =
    ((await plasmoGlobalStorage.get(STORAGE_KEYS.OLLAMA.BASE_URL)) as string) ??
    "http://localhost:11434"

  const controller = new AbortController()
  pullAbortControllers[modelName] = controller

  try {
    const requestBody: OllamaPullRequest = {
      name: modelName
    }

    const res = await fetch(`${baseUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    })

    if (!res.ok) {
      safePostMessage(port, {
        error: { status: res.status, message: res.statusText }
      })
      return
    }

    if (!res.body) {
      safePostMessage(port, { error: "No response body received" })
      return
    }

    await handlePullStream(res, port, isPortClosed, modelName)
  } catch (err) {
    const error = err as NetworkError
    if (error.name === "AbortError") {
      safePostMessage(port, { error: "Download cancelled" })
    } else {
      safePostMessage(port, {
        error: { status: 0, message: error.message || "Failed to pull model" }
      })
    }
    delete pullAbortControllers[modelName]
  }
}

// Handle streaming response for model pulling
async function handlePullStream(
  res: Response,
  port: ChromePort,
  isPortClosed: PortStatusFunction,
  modelName: string
): Promise<void> {
  if (!res.body) return

  const reader = res.body.getReader()
  const decoder = new TextDecoder("utf-8")
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      // Check if port is still connected
      if (isPortClosed()) {
        reader.cancel().catch(console.error)
        break
      }

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
          const data: OllamaPullResponse = JSON.parse(trimmedLine)

          // Handle different response types from Ollama
          if (data.status) {
            safePostMessage(port, { status: data.status })

            // Check for completion - Ollama returns "success" when done
            if (data.status === "success") {
              safePostMessage(port, { done: true })
              delete pullAbortControllers[modelName]
              return
            }
          }

          // Handle error responses
          if (data.error) {
            safePostMessage(port, { error: data.error })
            delete pullAbortControllers[modelName]
            return
          }

          // Handle progress updates (downloading, verifying, etc.)
          if (data.completed !== undefined && data.total !== undefined) {
            const progress = Math.round((data.completed / data.total) * 100)
            safePostMessage(port, {
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
    if (buffer.trim() && !isPortClosed()) {
      try {
        const data: OllamaPullResponse = JSON.parse(buffer.trim())
        if (data.status === "success") {
          safePostMessage(port, { done: true })
        }
      } catch (parseError) {
        console.warn("Failed to parse final buffer:", buffer, parseError)
      }
    }
  } finally {
    delete pullAbortControllers[modelName]
  }
}

// Main connection handler
chrome.runtime.onConnect.addListener((port: ChromePort) => {
  let isPortClosed = false

  const getPortStatus: PortStatusFunction = () => isPortClosed

  port.onDisconnect.addListener(() => {
    isPortClosed = true
    // Clean up any ongoing operations when port is disconnected
    abortController?.abort()
  })

  port.onMessage.addListener(async (msg: ChromeMessage) => {
    if (msg.type === MESSAGE_KEYS.OLLAMA.CHAT_WITH_MODEL) {
      await handleChatWithModel(
        msg as ChatWithModelMessage,
        port,
        getPortStatus
      )
    }

    if (msg.type === MESSAGE_KEYS.OLLAMA.STOP_GENERATION) {
      console.log("Stop generation requested")
      abortController?.abort()
      abortController = null // Reset the controller
    }
  })

  if (port.name === MESSAGE_KEYS.OLLAMA.PULL_MODEL) {
    port.onMessage.addListener(async (msg: ModelPullMessage) => {
      await handleModelPull(msg, port, getPortStatus)
    })
  }
})

// Handle one-time message requests
chrome.runtime.onMessage.addListener(
  (message: ChromeMessage, sender, sendResponse) => {
    switch (message.type) {
      case MESSAGE_KEYS.OLLAMA.GET_MODELS: {
        handleGetModels(sendResponse)
        return true
      }

      case MESSAGE_KEYS.OLLAMA.SHOW_MODEL_DETAILS: {
        if (typeof message.payload === "string") {
          handleShowModelDetails(message.payload, sendResponse)
        }
        return true
      }

      case MESSAGE_KEYS.BROWSER.OPEN_TAB: {
        chrome.tabs.query({}, (tabs) => {
          console.log(tabs)
          sendResponse({ success: true, tabs })
        })
        return true
      }

      case MESSAGE_KEYS.OLLAMA.SCRAPE_MODEL: {
        if (message.query && typeof message.query === "string") {
          handleScrapeModel(message.query, sendResponse)
          return true
        }
        break
      }

      case MESSAGE_KEYS.OLLAMA.SCRAPE_MODEL_VARIANTS: {
        if (message.name && typeof message.name === "string") {
          handleScrapeModelVariants(message.name, sendResponse)
          return true
        }
        break
      }

      case MESSAGE_KEYS.OLLAMA.UPDATE_BASE_URL: {
        if (typeof message.payload === "string") {
          handleUpdateBaseUrl(message.payload, sendResponse)
        }
        return true
      }
    }
  }
)

// Handle get models request
async function handleGetModels(
  sendResponse: SendResponseFunction
): Promise<void> {
  try {
    const url = (await plasmoGlobalStorage.get(
      STORAGE_KEYS.OLLAMA.BASE_URL
    )) as string
    const OllamaBaseUrl = url ?? "http://localhost:11434"

    const res = await fetch(`${OllamaBaseUrl}/api/tags`)
    if (!res.ok) {
      sendResponse({
        success: false,
        error: { status: res.status, message: res.statusText }
      })
      return
    }

    const data: OllamaTagsResponse = await res.json()
    sendResponse({ success: true, data })
  } catch (err) {
    const error = err as Error
    sendResponse({
      success: false,
      error: { status: 0, message: error.message }
    })
  }
}

// Handle show model details request
async function handleShowModelDetails(
  model: string,
  sendResponse: SendResponseFunction
): Promise<void> {
  try {
    const url = (await plasmoGlobalStorage.get(
      STORAGE_KEYS.OLLAMA.BASE_URL
    )) as string
    const baseUrl = url ?? "http://localhost:11434"

    const requestBody: OllamaShowRequest = { name: model }

    const res = await fetch(`${baseUrl}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    })

    if (!res.ok) {
      sendResponse({
        success: false,
        error: { status: res.status, message: res.statusText }
      })
      return
    }

    const data: OllamaShowResponse = await res.json()
    sendResponse({ success: true, data })
  } catch (err) {
    const error = err as Error
    sendResponse({
      success: false,
      error: { status: 0, message: error.message }
    })
  }
}

// Handle scrape model request
async function handleScrapeModel(
  query: string,
  sendResponse: SendResponseFunction
): Promise<void> {
  try {
    const res = await fetch(
      `https://ollama.com/search?q=${encodeURIComponent(query)}`
    )
    const html = await res.text()
    sendResponse({ success: true, html })
  } catch (err) {
    const error = err as Error
    sendResponse({
      success: false,
      error: { status: 0, message: error.message }
    })
  }
}

// Handle scrape model variants request
async function handleScrapeModelVariants(
  name: string,
  sendResponse: SendResponseFunction
): Promise<void> {
  try {
    const res = await fetch(
      `https://ollama.com/library/${encodeURIComponent(name)}`
    )
    const html = await res.text()
    sendResponse({ success: true, html })
  } catch (err) {
    const error = err as Error
    sendResponse({
      success: false,
      error: { status: 0, message: error.message }
    })
  }
}

// Handle update base URL request
async function handleUpdateBaseUrl(
  payload: string,
  sendResponse: SendResponseFunction
): Promise<void> {
  try {
    const origin = new URL(payload).origin

    await chrome.declarativeNetRequest.updateDynamicRules({
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

    sendResponse({ success: true })
  } catch (err) {
    const error = err as Error
    sendResponse({
      success: false,
      error: { status: 0, message: error.message }
    })
  }
}
