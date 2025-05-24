import { useSelectedTabIds } from "@/context/selected-tab-ids-context"
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constant"
import { useEffect, useRef, useState } from "react"

import { useStorage } from "@plasmohq/storage/hook"

import { useTabContents } from "./use-tab-contents"

export type Role = "user" | "assistant"

export interface ChatMessage {
  role: Role
  content: string
  done?: boolean
  model?: string
}

export const useChat = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [selectedModel] = useStorage<string>(
    STORAGE_KEYS.OLLAMA.SELECTED_MODEL,
    ""
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const portRef = useRef<chrome.runtime.Port | null>(null)

  const { tabContents, errors } = useTabContents()
  const { selectedTabIds } = useSelectedTabIds()

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const sendMessage = (customInput?: string, customModel?: string) => {
    const messageText = customInput?.trim() ?? input.trim()
    if (!messageText) return

    // Build tab context
    const buildContextText = () => {
      return selectedTabIds
        .map((id, index) => {
          const tabId = parseInt(id)
          const content = tabContents[tabId]
          const title = content?.title || "Untitled"
          const header = `Context-${index + 1}`

          if (errors[tabId]) {
            return `${header}\nTitle: ${title}\nContent:\n❌ Error: ${errors[tabId]}`
          }

          if (!content) {
            return `${header}\nTitle: ${title}\nContent:\n(No content)`
          }

          return `${header}\nTitle: ${title}\nContent:\n${content.html}`
        })
        .join("\n\n---\n\n")
    }

    let contentWithContext = messageText
    if (selectedTabIds.length > 0) {
      const contextText = buildContextText()
      contentWithContext += `\n\n---\n\n\n${contextText}`
    }

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
          setMessages([
            ...newMessages,
            { role: "assistant", content: `❌ Error: ${msg.error}`, done: true }
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
        model: customModel || selectedModel,
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
    input,
    setInput,
    messages,
    isLoading,
    sendMessage,
    stopGeneration,
    scrollRef
  }
}
