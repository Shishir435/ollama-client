import { useRef } from "react"
import { useTranslation } from "react-i18next"
import { useToast } from "@/hooks/use-toast"

import { browser } from "@/lib/browser-api"
import { ERROR_MESSAGES, MESSAGE_KEYS } from "@/lib/constants"
import type { ChatMessage } from "@/types"

interface StreamOptions {
  model: string
  messages: ChatMessage[]
  sessionId?: string
  generatedMessage?: ChatMessage
}

interface StreamMessage {
  type?: string
  payload?: {
    sources?: Array<{
      id: string | number
      title: string
      content: string
      score: number
      source?: string
      chunkIndex?: number
      fileId?: string
      type?: string
    }>
    query?: string
  }
  delta?: string
  done?: boolean
  error?: {
    status: number
    message: string
  }
  aborted?: boolean
  metrics?: Record<string, unknown>
}

interface UseChatStreamProps {
  setMessages: (messages: ChatMessage[]) => void
  setIsLoading: (v: boolean) => void
  setIsStreaming: (v: boolean) => void
  onToken?: (token: string) => void
}

export const useChatStream = ({
  setMessages,
  setIsLoading,
  setIsStreaming,
  onToken
}: UseChatStreamProps) => {
  const { t } = useTranslation()
  const { toast } = useToast()
  const portRef = useRef<browser.Runtime.Port | null>(null)
  const currentMessagesRef = useRef<ChatMessage[]>([])

  const startStream = ({
    model,
    messages,
    sessionId,
    generatedMessage
  }: StreamOptions) => {
    // Create port synchronously BEFORE any async operations
    const port = browser.runtime.connect({
      name: MESSAGE_KEYS.PROVIDER.STREAM_RESPONSE
    })
    portRef.current = port

    setIsLoading(true)
    setIsStreaming(false)

    const assistantMessage: ChatMessage = generatedMessage || {
      role: "assistant",
      content: "",
      model
    }

    // Initialize with user + assistant shell
    currentMessagesRef.current = [...messages, assistantMessage]
    setMessages(currentMessagesRef.current)

    let firstChunk = true

    const listener = (msg: StreamMessage) => {
      if (firstChunk) {
        setIsStreaming(true)
        firstChunk = false
      }

      if (msg.type === "rag_sources" && msg.payload?.sources) {
        assistantMessage.metrics = {
          ...assistantMessage.metrics,
          ragSources: msg.payload.sources,
          ragQuery: msg.payload.query
        }
        return
      }

      if (msg.delta !== undefined) {
        if (onToken) {
          onToken(msg.delta)
        }

        assistantMessage.content += msg.delta
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
            t("chat.errors.unknown_error", {
              message: msg.error.message || t("chat.errors.no_message")
            })
          finalMessages = [
            ...currentMessagesRef.current.slice(0, -1),
            { role: "assistant", content: errMsg, done: true }
          ]
          toast({
            variant: "destructive",
            title: t("chat.errors.response_failed_title"),
            description:
              msg.error.message || t("chat.errors.unknown_error_description")
          })
        } else {
          finalMessages = [
            ...currentMessagesRef.current.slice(0, -1),
            {
              ...assistantMessage,
              metrics: {
                ...assistantMessage.metrics,
                ...msg.metrics
              },
              done: true
            }
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
      type: MESSAGE_KEYS.PROVIDER.CHAT_WITH_MODEL,
      payload: {
        model,
        messages,
        sessionId
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
        type: MESSAGE_KEYS.PROVIDER.STOP_GENERATION
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
