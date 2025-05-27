import { useChatInput } from "@/context/chat-input-context"
import { useSelectedTabIds } from "@/context/selected-tab-ids-context"
import { useTabContentContext } from "@/context/tab-context-context"
import { ERROR_MESSAGES, MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constant"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { useEffect, useRef, useState } from "react"

import { useStorage } from "@plasmohq/storage/hook"

export type Role = "user" | "assistant"

export interface ChatMessage {
  role: Role
  content: string
  done?: boolean
  model?: string
}

export const useChat = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [selectedModel] = useStorage<string>(
    { key: STORAGE_KEYS.OLLAMA.SELECTED_MODEL, instance: plasmoGlobalStorage },
    ""
  )

  const { input, setInput } = useChatInput()
  const { selectedTabIds } = useSelectedTabIds()
  const contextText = useTabContentContext()

  const scrollRef = useRef<HTMLDivElement>(null)
  const portRef = useRef<chrome.runtime.Port | null>(null)

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const sendMessage = (customInput?: string, customModel?: string) => {
    const rawInput = customInput?.trim() ?? input.trim()
    if (!rawInput) return

    // Only add context if not customInput (i.e. initial message, not regenerated)
    const includeContext =
      !customInput && selectedTabIds.length > 0 && contextText?.trim()
    const contentWithContext = includeContext
      ? `${rawInput}\n\n---\n\n${contextText}`
      : rawInput

    const userMessage: ChatMessage = {
      role: "user",
      content: contentWithContext
    }

    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    if (!customInput) setInput("")
    setIsLoading(true)

    const port = chrome.runtime.connect({
      name: MESSAGE_KEYS.OLLAMA.STREAM_RESPONSE
    })

    portRef.current = port
    const modelUsed = customModel || selectedModel

    let assistantMessage: ChatMessage = {
      role: "assistant",
      content: "",
      model: modelUsed
    }

    setMessages([...newMessages, assistantMessage])

    port.onMessage.addListener((msg) => {
      if (msg.delta !== undefined) {
        assistantMessage = {
          ...assistantMessage,
          content: assistantMessage.content + msg.delta
        }
        setMessages([...newMessages, { ...assistantMessage }])
      }

      if (msg.done || msg.error || msg.aborted) {
        setIsLoading(false)
        if (msg.error) {
          const { status } = msg.error
          const errorMessage =
            ERROR_MESSAGES[status] ??
            `❌ Unknown error: ${msg.error.message || "No message"}`

          setMessages([
            ...newMessages,
            { role: "assistant", content: errorMessage, done: true }
          ])
        } else {
          assistantMessage = { ...assistantMessage, done: true }
          setMessages([...newMessages, assistantMessage])
        }
        port.disconnect()
        portRef.current = null
      }
    })

    port.postMessage({
      type: MESSAGE_KEYS.OLLAMA.CHAT_WITH_MODEL,
      payload: {
        model: modelUsed,
        messages: newMessages
      }
    })
  }

  const stopGeneration = () => {
    portRef.current?.postMessage({
      type: MESSAGE_KEYS.OLLAMA.STOP_GENERATION
    })
    setIsLoading(false)
  }

  return {
    messages,
    isLoading,
    sendMessage,
    stopGeneration,
    scrollRef
  }
}
