import { useRef } from "react"

import type { ChatMessage } from "@/hooks/use-chat"
import { ERROR_MESSAGES, MESSAGE_KEYS } from "@/lib/constant"

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

  const startStream = ({ model, messages }: StreamOptions) => {
    const port = chrome.runtime.connect({
      name: MESSAGE_KEYS.OLLAMA.STREAM_RESPONSE
    })
    portRef.current = port

    let assistantMessage: ChatMessage = {
      role: "assistant",
      content: "",
      model
    }

    setMessages([...messages, assistantMessage])
    let firstChunk = true

    port.onMessage.addListener((msg) => {
      if (firstChunk) {
        setIsStreaming(true)
        firstChunk = false
      }

      if (msg.delta !== undefined) {
        assistantMessage.content += msg.delta
        setMessages([...messages, { ...assistantMessage }])
      }

      if (msg.done || msg.error || msg.aborted) {
        setIsLoading(false)
        setIsStreaming(false)

        if (msg.error) {
          const status = msg.error.status
          const errMsg =
            ERROR_MESSAGES[status] ??
            `❌ Unknown error: ${msg.error.message || "No message"}`
          setMessages([
            ...messages,
            { role: "assistant", content: errMsg, done: true }
          ])
        } else {
          setMessages([...messages, { ...assistantMessage, done: true }])
        }

        port.disconnect()
        portRef.current = null
      }
    })

    port.postMessage({
      type: MESSAGE_KEYS.OLLAMA.CHAT_WITH_MODEL,
      payload: {
        model,
        messages
      }
    })
  }

  const stopStream = () => {
    portRef.current?.postMessage({ type: MESSAGE_KEYS.OLLAMA.STOP_GENERATION })
    setIsLoading(false)
    setIsStreaming(false)
  }

  return {
    startStream,
    stopStream
  }
}
