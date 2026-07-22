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
import type { ChatMessage } from "@/types"
import {
  makeStreamReducerState,
  reduceStreamEvent,
  type StreamMessage,
  type StreamReducerState
} from "./chat-stream-reducer"

interface StreamOptions {
  model: string
  providerId?: string
  messages: ChatMessage[]
  sessionId?: string
  generatedMessage?: ChatMessage
  /** See {@link ChatWithModelMessage} `clientContextPrepared`. */
  clientContextPrepared?: boolean
}

export interface UseChatStreamProps {
  setMessages: (messages: ChatMessage[]) => void | Promise<void>
  setIsLoading: (v: boolean) => void
  setIsStreaming: (v: boolean) => void
  onToken?: (token: string) => void
  onSuccessfulResponse?: (message: ChatMessage) => void | Promise<void>
}

export const useChatStream = ({
  setMessages,
  setIsLoading,
  setIsStreaming,
  onToken,
  onSuccessfulResponse
}: UseChatStreamProps) => {
  const DEBUG_THINKING_STREAM = false
  const { t } = useTranslation()
  const { toast } = useToast()
  const portRef = useRef<browser.Runtime.Port | null>(null)
  const currentMessagesRef = useRef<ChatMessage[]>([])
  const currentRequestIdRef = useRef<string | null>(null)
  // The request id of a turn the user explicitly stopped. Lets the disconnect
  // handler tell a user-initiated stop (finalize cleanly) from an unexpected
  // worker/port death (finalize as interrupted, offer retry).
  const manualStopRequestIdRef = useRef<string | null>(null)
  // Finalizes the active turn's assistant message as a clean `done:true` and
  // persists it (via the render → persistence bridge). Set by the active
  // stream; invoked by `stopStream`, because calling `port.disconnect()`
  // ourselves does NOT fire our own `onDisconnect`, so the disconnect fallback
  // never runs on a manual stop and the row would otherwise stay `done=0`.
  const finalizeCleanRef = useRef<(() => void) | null>(null)

  const startStream = ({
    model,
    providerId,
    messages,
    sessionId,
    generatedMessage,
    clientContextPrepared
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

    // Initialize with user + assistant shell. `messages` is the stable base
    // (everything before the assistant turn); every render replaces only the
    // trailing assistant message with the reducer's latest.
    currentMessagesRef.current = [...messages, assistantMessage]
    setMessages(currentMessagesRef.current)

    // All per-turn accumulation lives in the reducer state; the hook keeps
    // only the port-lifecycle flags. `state.lastSeq` resets to -1 on reconnect
    // because a restarted worker restarts its sequence counter at 0.
    let state: StreamReducerState = makeStreamReducerState(assistantMessage)
    let streamSettled = false
    let resumeAttempts = 0

    const renderAssistant = (assistant: ChatMessage) => {
      const updated = [...messages, assistant]
      currentMessagesRef.current = updated
      setMessages(updated)
    }

    // Persist a clean completion for the current partial answer. Used by a
    // user stop, where no terminal stream event arrives to flip `done`.
    finalizeCleanRef.current = () => {
      if (streamSettled || state.assistant.done) return
      state = { ...state, assistant: { ...state.assistant, done: true } }
      renderAssistant(state.assistant)
    }

    const requestPayload = {
      model,
      providerId,
      messages,
      sessionId,
      requestId,
      clientContextPrepared
    }

    const cleanupPort = () => {
      streamSettled = true
      finalizeCleanRef.current = null
      port.onMessage.removeListener(listener)
      port.onDisconnect.removeListener(handleDisconnect)
      port.disconnect()
      if (portRef.current === port) {
        portRef.current = null
        currentRequestIdRef.current = null
      }
    }

    const listener = (rawMsg: unknown) => {
      if (streamSettled) return
      const msg = rawMsg as StreamMessage

      // Fold the chunk into turn state purely; the hook only performs effects.
      const result = reduceStreamEvent(state, msg)
      state = result.state
      if (result.dropped) return

      if (DEBUG_THINKING_STREAM) {
        logger.debug("Stream msg", "useChatStream", {
          type: msg.type,
          hasDelta: typeof msg.delta === "string" && msg.delta.length > 0,
          hasThinkingDelta:
            typeof msg.thinkingDelta === "string" &&
            msg.thinkingDelta.length > 0,
          done: msg.done,
          aborted: msg.aborted,
          error: msg.error
        })
      }

      if (result.justStarted) setIsStreaming(true)
      if (onToken) {
        for (const token of result.tokens) onToken(token)
      }

      if (result.terminal) {
        setIsLoading(false)
        setIsStreaming(false)

        if (result.terminal.type === "error") {
          const { error, partial } = result.terminal
          const isProviderError = error.kind === "provider"
          const errorProviderId = isProviderError
            ? error.providerId || providerId
            : undefined
          const providerName = errorProviderId
            ? getProviderDisplayName(errorProviderId, errorProviderId)
            : undefined
          const issueUrl =
            isProviderError && error.status >= 500
              ? buildProviderServerIssueUrl(error.status, {
                  providerName,
                  model
                })
              : undefined
          const localizedUserMessage = error.messageKey
            ? t(error.messageKey)
            : error.userMessage
          const displayError = formatErrorForDisplay(
            { ...error, userMessage: localizedUserMessage },
            t("chat.errors.unknown_error_description")
          )
          const errMsg =
            localizedUserMessage ??
            ERROR_MESSAGES[error.status] ??
            // Any provider error with a real HTTP status gets the clean
            // per-status copy — raw response bodies never render in chat.
            (isProviderError && error.status > 0
              ? providerErrorUserMessage(error.status, {
                  providerName,
                  model
                })
              : t("chat.errors.unknown_error", {
                  message:
                    getDisplayErrorMessage(error) || t("chat.errors.no_message")
                }))
          const chatErrorMessage = issueUrl
            ? `${errMsg}\n\n[Open a new issue](${issueUrl})`
            : errMsg
          const toastDescription =
            error.kind === "provider" && providerName
              ? `${displayError.rawMessage}${
                  error.retryable ? " This may be temporary; try again." : ""
                }`
              : displayError.message
          void renderAssistant({
            ...partial,
            content: chatErrorMessage,
            done: true,
            error: {
              status: error.status,
              kind: error.kind,
              retryable: error.retryable,
              retryAfterMs: error.retryAfterMs
            }
          })
          toast({
            variant: "destructive",
            title: displayError.kind
              ? error.kind === "provider" && providerName
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
          const message = result.terminal.message
          Promise.resolve(renderAssistant(message))
            .then(() => onSuccessfulResponse?.(message))
            .catch((error) => {
              logger.debug(
                "Successful response post-persistence callback failed",
                "useChatStream",
                { error }
              )
            })
        }

        cleanupPort()
        return
      }

      if (result.changed) renderAssistant(state.assistant)
    }

    const handleDisconnect = () => {
      if (browser.runtime.lastError) {
        logger.debug("Port disconnected unexpectedly", "useChatStream", {
          error: browser.runtime.lastError.message
        })
      }
      const awaitingConfirmation =
        state.assistant.metrics?.toolRuns?.some(
          (run) => run.status === "awaiting-confirmation"
        ) ?? false

      // Reconnect with the same request id after an MV3 worker restart.
      // Background restores its force-flushed SQLite checkpoint and
      // re-registers the exact pending tool call.
      if (
        !streamSettled &&
        !state.assistant.done &&
        awaitingConfirmation &&
        currentRequestIdRef.current === requestId &&
        resumeAttempts < 3
      ) {
        resumeAttempts += 1
        window.setTimeout(() => {
          if (
            streamSettled ||
            state.assistant.done ||
            currentRequestIdRef.current !== requestId
          ) {
            return
          }
          // Restarted worker restarts its sequence at 0 — accept it afresh.
          state = { ...state, lastSeq: -1 }
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

      if (!streamSettled && !state.assistant.done) {
        setIsLoading(false)
        setIsStreaming(false)
        // A user-initiated stop finalizes cleanly. An unexpected disconnect
        // (worker death) truncated a live answer: flag it interrupted so the
        // startup sweep's `done=0` scan isn't the only recovery path — the
        // partial persists with the interrupted note + retry immediately.
        const userStopped = manualStopRequestIdRef.current === requestId
        const finalized: ChatMessage = {
          ...state.assistant,
          done: true,
          ...(userStopped
            ? {}
            : { metrics: { ...state.assistant.metrics, interrupted: true } })
        }
        state = { ...state, assistant: finalized }
        renderAssistant(finalized)
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
      // Record the stop so a racing disconnect finalizes cleanly rather than
      // flagging this turn as interrupted.
      manualStopRequestIdRef.current = requestId
      // Persist the partial answer as a clean completion now. `disconnect()`
      // below won't fire our own `onDisconnect`, so this is the only place the
      // stopped turn gets its `done:true` written — otherwise the recovery
      // sweep would later mark this clean stop as interrupted.
      finalizeCleanRef.current?.()
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
