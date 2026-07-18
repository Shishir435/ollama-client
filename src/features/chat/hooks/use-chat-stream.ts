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
  buildProviderServerIssueUrl,
  providerErrorUserMessage
} from "@/lib/providers/provider-errors"
import { getProviderDisplayName } from "@/lib/providers/registry"
import {
  makeThinkingParserState,
  splitThinkingDelta,
  type ThinkingParserState
} from "@/lib/thinking-parser"
import type { ChatMessage, ProviderReplayArtifact, ToolRun } from "@/types"

interface StreamOptions {
  model: string
  providerId?: string
  messages: ChatMessage[]
  sessionId?: string
  generatedMessage?: ChatMessage
}

interface StreamMessage {
  type?: string
  message?: {
    content?: string
    thinking?: string
    reasoning?: string
    reasoning_content?: string
  }
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
  replayArtifact?: ProviderReplayArtifact
  toolRuns?: ToolRun[]
  done?: boolean
  error?: {
    status: number
    message: string
    kind?: import("@/types/errors").AppErrorKind
    messageKey?: string
    userMessage?: string
    retryable?: boolean
    retryAfterMs?: number
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
  const currentRequestIdRef = useRef<string | null>(null)

  const startStream = ({
    model,
    providerId,
    messages,
    sessionId,
    generatedMessage
  }: StreamOptions) => {
    // Create port synchronously BEFORE any async operations
    let port = browser.runtime.connect({
      name: MESSAGE_KEYS.PROVIDER.STREAM_RESPONSE
    })
    portRef.current = port
    const requestId =
      globalThis.crypto?.randomUUID?.() ||
      `chat-stream-${Date.now()}-${Math.random().toString(36).slice(2)}`
    currentRequestIdRef.current = requestId

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
    let streamSettled = false
    let resumeAttempts = 0
    const thinkingState: ThinkingParserState = makeThinkingParserState()
    const requestPayload = {
      model,
      providerId,
      messages,
      sessionId,
      requestId
    }

    const cleanupPort = () => {
      streamSettled = true
      port.onMessage.removeListener(listener)
      port.onDisconnect.removeListener(handleDisconnect)
      port.disconnect()
      if (portRef.current === port) {
        portRef.current = null
        currentRequestIdRef.current = null
      }
    }

    const listener = (rawMsg: unknown) => {
      const msg = rawMsg as StreamMessage
      if (streamSettled) return
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
        logger.debug("Stream msg detail", "useChatStream", {
          type: msg.type,
          done: msg.done,
          aborted: msg.aborted,
          error: msg.error,
          metrics: msg.metrics
        })
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
      const rawThinkingDelta =
        msg.message?.thinking ||
        msg.message?.reasoning ||
        msg.message?.reasoning_content
      const normalizedThinkingDelta = msg.thinkingDelta ?? rawThinkingDelta

      // Live tool-run trace snapshot — replace with the latest so the
      // chain-of-thought trace reflects what tools are running / have run.
      if (msg.toolRuns) {
        assistantMessage.metrics = {
          ...assistantMessage.metrics,
          toolRuns: msg.toolRuns
        }
        didUpdate = true
      }

      if (msg.replayArtifact) {
        assistantMessage.replayArtifact = msg.replayArtifact
        didUpdate = true
      }

      if (normalizedThinkingDelta) {
        if (DEBUG_THINKING_STREAM) {
          logger.debug("ThinkingStream delta", "useChatStream", {
            delta: normalizedThinkingDelta
          })
        }
        assistantMessage.thinking = `${assistantMessage.thinking || ""}${normalizedThinkingDelta}`
        didUpdate = true
      }

      const normalizedDelta = msg.delta ?? msg.message?.content
      if (normalizedDelta !== undefined) {
        const { visible, thinking } = splitThinkingDelta(
          normalizedDelta,
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
          const isProviderError = msg.error.kind === "provider"
          const errorProviderId = isProviderError
            ? msg.error.providerId || providerId
            : undefined
          const providerName = errorProviderId
            ? getProviderDisplayName(errorProviderId, errorProviderId)
            : undefined
          const issueUrl =
            isProviderError && msg.error.status >= 500
              ? buildProviderServerIssueUrl(msg.error.status, {
                  providerName,
                  model
                })
              : undefined
          const localizedUserMessage = msg.error.messageKey
            ? t(msg.error.messageKey)
            : msg.error.userMessage
          const displayError = formatErrorForDisplay(
            { ...msg.error, userMessage: localizedUserMessage },
            t("chat.errors.unknown_error_description")
          )
          const errMsg =
            localizedUserMessage ??
            ERROR_MESSAGES[msg.error.status] ??
            // Any provider error with a real HTTP status gets the clean
            // per-status copy — raw response bodies never render in chat.
            (isProviderError && msg.error.status > 0
              ? providerErrorUserMessage(msg.error.status, {
                  providerName,
                  model
                })
              : t("chat.errors.unknown_error", {
                  message:
                    getDisplayErrorMessage(msg.error) ||
                    t("chat.errors.no_message")
                }))
          const chatErrorMessage = issueUrl
            ? `${errMsg}\n\n[Open a new issue](${issueUrl})`
            : errMsg
          const toastDescription =
            msg.error.kind === "provider" && providerName
              ? `${displayError.rawMessage}${
                  msg.error.retryable
                    ? " This may be temporary; try again."
                    : ""
                }`
              : displayError.message
          finalMessages = [
            ...currentMessagesRef.current.slice(0, -1),
            {
              ...assistantMessage,
              content: chatErrorMessage,
              done: true,
              error: {
                status: msg.error.status,
                kind: msg.error.kind,
                retryable: msg.error.retryable,
                retryAfterMs: msg.error.retryAfterMs
              }
            }
          ]
          toast({
            variant: "destructive",
            title: displayError.kind
              ? msg.error.kind === "provider" && providerName
                ? `${providerName} error`
                : displayError.title
              : t("chat.errors.response_failed_title"),
            description: toastDescription,
            ...(issueUrl && {
              action: {
                label: "Open new issue",
                onClick: () => {
                  void browser.tabs.create({ url: issueUrl })
                }
              }
            })
          })
        } else {
          const thinkingOnlyResponse =
            !assistantMessage.content.trim() &&
            Boolean(assistantMessage.thinking?.trim())
          const toolBackedThinkingOnlyResponse =
            thinkingOnlyResponse &&
            (assistantMessage.metrics?.toolRuns?.length ?? 0) > 0
          const finalAssistantMessage = thinkingOnlyResponse
            ? {
                ...assistantMessage,
                content: toolBackedThinkingOnlyResponse
                  ? assistantMessage.thinking?.trim() || ""
                  : "I did not receive a final answer from the model. Please try again.",
                metrics: {
                  ...assistantMessage.metrics,
                  thinkingOnlyResponse: true
                }
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
        assistantMessage.done = true
        cleanupPort()
      }
    }

    const handleDisconnect = () => {
      if (browser.runtime.lastError) {
        logger.debug("Port disconnected unexpectedly", "useChatStream", {
          error: browser.runtime.lastError.message
        })
      }
      const awaitingConfirmation =
        assistantMessage.metrics?.toolRuns?.some(
          (run) => run.status === "awaiting-confirmation"
        ) ?? false

      // Reconnect with the same request id after an MV3 worker restart.
      // Background restores its force-flushed SQLite checkpoint and
      // re-registers the exact pending tool call.
      if (
        !streamSettled &&
        !assistantMessage.done &&
        awaitingConfirmation &&
        currentRequestIdRef.current === requestId &&
        resumeAttempts < 3
      ) {
        resumeAttempts += 1
        window.setTimeout(() => {
          if (
            streamSettled ||
            assistantMessage.done ||
            currentRequestIdRef.current !== requestId
          ) {
            return
          }
          port = browser.runtime.connect({
            name: MESSAGE_KEYS.PROVIDER.STREAM_RESPONSE
          })
          portRef.current = port
          port.onMessage.addListener(listener)
          port.onDisconnect.addListener(handleDisconnect)
          port.postMessage({
            type: MESSAGE_KEYS.PROVIDER.CHAT_WITH_MODEL,
            payload: requestPayload
          })
        }, 250)
        return
      }

      if (!streamSettled && !assistantMessage.done) {
        setIsLoading(false)
        setIsStreaming(false)
        assistantMessage.done = true
        const updated = [
          ...currentMessagesRef.current.slice(0, -1),
          { ...assistantMessage }
        ]
        currentMessagesRef.current = updated
        setMessages(updated)
        if (portRef.current === port) {
          portRef.current = null
          currentRequestIdRef.current = null
        }
      }
    }

    port.onMessage.addListener(listener)
    port.onDisconnect.addListener(handleDisconnect)
    port.postMessage({
      type: MESSAGE_KEYS.PROVIDER.CHAT_WITH_MODEL,
      payload: requestPayload
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
      const requestId = currentRequestIdRef.current
      currentRequestIdRef.current = null
      portRef.current.postMessage({
        type: MESSAGE_KEYS.PROVIDER.STOP_GENERATION,
        payload: requestId ? { requestId } : undefined
      })
      portRef.current.disconnect()
      portRef.current = null
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
