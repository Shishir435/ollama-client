import { useRef } from "react"
import { useTranslation } from "react-i18next"
import { useToast } from "@/hooks/use-toast"

import { browser } from "@/lib/browser-api"
import { ERROR_MESSAGES, MESSAGE_KEYS } from "@/lib/constants"
import {
  formatErrorForDisplay,
  getDisplayErrorMessage
} from "@/lib/error-display"
import { logger } from "@/lib/logger"
import {
  makeThinkingParserState,
  splitThinkingDelta,
  type ThinkingParserState
} from "@/lib/thinking-parser"
import type { ChatMessage, ToolRun } from "@/types"

interface StreamOptions {
  model: string
  providerId?: string
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
  thinkingDelta?: string
  toolRuns?: ToolRun[]
  done?: boolean
  error?: {
    status: number
    message: string
    kind?: import("@/types/errors").AppErrorKind
    userMessage?: string
    retryable?: boolean
    context?: string
    providerId?: string
    debug?: unknown
  }
  aborted?: boolean
  metrics?: Record<string, unknown>
}

export interface UseChatStreamProps {
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
  const DEBUG_THINKING_STREAM = false
  const { t } = useTranslation()
  const { toast } = useToast()
  const portRef = useRef<browser.Runtime.Port | null>(null)
  const currentMessagesRef = useRef<ChatMessage[]>([])

  const startStream = ({
    model,
    providerId,
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
    const thinkingState: ThinkingParserState = makeThinkingParserState()

    const listener = (msg: StreamMessage) => {
      if (DEBUG_THINKING_STREAM) {
        logger.debug("Stream msg", "useChatStream", {
          type: msg.type,
          hasDelta: typeof msg.delta === "string" && msg.delta.length > 0,
          deltaPreview:
            typeof msg.delta === "string" ? msg.delta.slice(0, 120) : undefined,
          hasThinkingDelta:
            typeof msg.thinkingDelta === "string" &&
            msg.thinkingDelta.length > 0,
          thinkingPreview:
            typeof msg.thinkingDelta === "string"
              ? msg.thinkingDelta.slice(0, 120)
              : undefined,
          done: msg.done,
          error: msg.error
        })
        logger.debug("MSG", "useChatStream", JSON.stringify(msg, null, 3))
      }
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

      let didUpdate = false

      // Live tool-run trace snapshot — replace with the latest so the
      // chain-of-thought trace reflects what tools are running / have run.
      if (msg.toolRuns) {
        assistantMessage.metrics = {
          ...assistantMessage.metrics,
          toolRuns: msg.toolRuns
        }
        didUpdate = true
      }

      if (msg.thinkingDelta) {
        if (DEBUG_THINKING_STREAM) {
          logger.debug("ThinkingStream delta", "useChatStream", {
            delta: msg.thinkingDelta
          })
        }
        assistantMessage.thinking = `${assistantMessage.thinking || ""}${msg.thinkingDelta}`
        didUpdate = true
      }

      if (msg.delta !== undefined) {
        const { visible, thinking } = splitThinkingDelta(
          msg.delta,
          thinkingState
        )

        if (thinking) {
          if (DEBUG_THINKING_STREAM) {
            logger.debug("ThinkingStream parsed", "useChatStream", { thinking })
          }
          assistantMessage.thinking = `${assistantMessage.thinking || ""}${thinking}`
          didUpdate = true
        }

        if (visible) {
          if (onToken) {
            onToken(visible)
          }

          assistantMessage.content += visible
          didUpdate = true
        }
      }

      if (didUpdate) {
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
          const displayError = formatErrorForDisplay(
            msg.error,
            t("chat.errors.unknown_error_description")
          )
          const errMsg =
            msg.error.userMessage ??
            ERROR_MESSAGES[msg.error.status] ??
            t("chat.errors.unknown_error", {
              message:
                getDisplayErrorMessage(msg.error) || t("chat.errors.no_message")
            })
          finalMessages = [
            ...currentMessagesRef.current.slice(0, -1),
            { role: "assistant", content: errMsg, done: true }
          ]
          toast({
            variant: "destructive",
            title: displayError.kind
              ? displayError.title
              : t("chat.errors.response_failed_title"),
            description: displayError.message
          })
        } else {
          // Some local providers/models send the final answer in a reasoning
          // field instead of content. If there is no visible answer, surface it
          // as the answer rather than leaving it hidden in Thought Process.
          const finalAssistantMessage =
            !assistantMessage.content.trim() &&
            assistantMessage.thinking?.trim()
              ? {
                  ...assistantMessage,
                  content: assistantMessage.thinking,
                  thinking: undefined
                }
              : assistantMessage

          finalMessages = [
            ...currentMessagesRef.current.slice(0, -1),
            {
              ...finalAssistantMessage,
              metrics: {
                ...finalAssistantMessage.metrics,
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

    port.onDisconnect.addListener(() => {
      if (browser.runtime.lastError) {
        logger.debug("Port disconnected unexpectedly", "useChatStream", {
          error: browser.runtime.lastError.message
        })
      }
      if (!assistantMessage.done) {
        setIsLoading(false)
        setIsStreaming(false)
        assistantMessage.done = true
        const updated = [
          ...currentMessagesRef.current.slice(0, -1),
          { ...assistantMessage }
        ]
        currentMessagesRef.current = updated
        setMessages(updated)
        portRef.current = null
      }
    })

    port.postMessage({
      type: MESSAGE_KEYS.PROVIDER.CHAT_WITH_MODEL,
      payload: {
        model,
        providerId,
        messages,
        sessionId
      }
    })
  }

  const stopStream = () => {
    // Handle case where port hasn't been created yet
    if (!portRef.current) {
      logger.warn("Stop requested but port not created yet", "useChatStream")
      setIsLoading(false)
      setIsStreaming(false)
      return
    }

    try {
      portRef.current.postMessage({
        type: MESSAGE_KEYS.PROVIDER.STOP_GENERATION
      })
    } catch (error) {
      logger.error("Failed to send stop message", "useChatStream", { error })
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
