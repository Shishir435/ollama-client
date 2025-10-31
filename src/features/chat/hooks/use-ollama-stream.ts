import { useRef } from "react"

import { ERROR_MESSAGES, MESSAGE_KEYS } from "@/lib/constants"
import type { ChatMessage } from "@/types"

interface StreamOptions {
  model: string
  messages: ChatMessage[]
}

interface UseOllamaStreamProps {
  setMessages: (messages: ChatMessage[]) => void
  setIsLoading: (v: boolean) => void
  setIsStreaming: (v: boolean) => void
}

export const useOllamaStream = ({
  setMessages,
  setIsLoading,
  setIsStreaming
}: UseOllamaStreamProps) => {
  const portRef = useRef<chrome.runtime.Port | null>(null)
  const currentMessagesRef = useRef<ChatMessage[]>([])

  const startStream = ({ model, messages }: StreamOptions) => {
    const port = chrome.runtime.connect({
      name: MESSAGE_KEYS.OLLAMA.STREAM_RESPONSE
    })
    portRef.current = port

    // Now set loading state - port exists, so stop will work
    setIsLoading(true)
    setIsStreaming(false)

    let assistantMessage: ChatMessage = {
      role: "assistant",
      content: "",
      model
    }

    // Initialize with user + assistant shell
    currentMessagesRef.current = [...messages, assistantMessage]
    setMessages(currentMessagesRef.current)

    let firstChunk = true

    const listener = (msg: any) => {
      if (firstChunk) {
        setIsStreaming(true)
        firstChunk = false
      }

      if (msg.delta !== undefined) {
        assistantMessage.content += msg.delta
        // Replace the last message (assistant) with updated content
        const updated = [
          ...currentMessagesRef.current.slice(0, -1),
          { ...assistantMessage }
        ]
        currentMessagesRef.current = updated
        setMessages(updated)
      }

      if (msg.done || msg.error || msg.aborted) {
        setIsLoading(false)
        setIsStreaming(false)

        let finalMessages: ChatMessage[]

        if (msg.error) {
          const errMsg =
            ERROR_MESSAGES[msg.error.status] ??
            `❌ Unknown error: ${msg.error.message || "No message"}`
          finalMessages = [
            ...currentMessagesRef.current.slice(0, -1),
            { role: "assistant", content: errMsg, done: true }
          ]
        } else {
          finalMessages = [
            ...currentMessagesRef.current.slice(0, -1),
            { ...assistantMessage, metrics: msg.metrics, done: true }
          ]
        }

        currentMessagesRef.current = finalMessages
        setMessages(finalMessages)

        port.onMessage.removeListener(listener)
        port.disconnect()
        portRef.current = null
      }
    }

    port.onMessage.addListener(listener)

    port.postMessage({
      type: MESSAGE_KEYS.OLLAMA.CHAT_WITH_MODEL,
      payload: {
        model,
        messages
      }
    })
  }

  const stopStream = () => {
    // Handle case where port hasn't been created yet
    if (!portRef.current) {
      console.warn("Stop requested but port not created yet")
      setIsLoading(false)
      setIsStreaming(false)
      return
    }

    try {
      portRef.current.postMessage({
        type: MESSAGE_KEYS.OLLAMA.STOP_GENERATION
      })
    } catch (error) {
      console.error("Failed to send stop message:", error)
    } finally {
      // Always reset state, even if message fails
      setIsLoading(false)
      setIsStreaming(false)
    }
  }

  return {
    startStream,
    stopStream
  }
}
