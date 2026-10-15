import { useLayoutEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import {
  type ChatStreamPort,
  ChatStreamSession,
  type ChatStreamSessionCallbacks,
  type ChatStreamStartOptions
} from "@/application/turns/chat-stream-session"
import { useToast } from "@/hooks/use-toast"
import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import { EXTERNAL_URLS } from "@/lib/constants/urls"
import { getDisplayErrorMessage } from "@/lib/error-display"
import { logger } from "@/lib/logger"
import { providerErrorUserMessage } from "@/lib/providers/provider-errors"
import { getProviderDisplayName } from "@/lib/providers/registry"
import type { ChatMessage } from "@/types"

export type { ChatStreamClaim } from "@/application/turns/chat-stream-session"

export interface UseChatStreamProps {
  setMessages: (messages: ChatMessage[]) => void | Promise<void>
  setIsLoading: (v: boolean) => void
  setIsStreaming: (v: boolean) => void
  onToken?: (token: string) => void
  onSuccessfulResponse?: (message: ChatMessage) => void | Promise<void>
}

const createPort = (): ChatStreamPort => {
  const port = browser.runtime.connect({
    name: MESSAGE_KEYS.PROVIDER.STREAM_RESPONSE
  })
  return {
    postMessage: (message) => port.postMessage(message),
    disconnect: () => port.disconnect(),
    addMessageListener: (listener) => port.onMessage.addListener(listener),
    removeMessageListener: (listener) =>
      port.onMessage.removeListener(listener),
    addDisconnectListener: (listener) =>
      port.onDisconnect.addListener(listener),
    removeDisconnectListener: (listener) =>
      port.onDisconnect.removeListener(listener)
  }
}

const createRequestId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `chat-stream-${Date.now()}-${Math.random().toString(36).slice(2)}`

type TerminalCallback = NonNullable<ChatStreamSessionCallbacks["onTerminal"]>
type Terminal = Parameters<TerminalCallback>[0]
type TerminalOptions = Parameters<TerminalCallback>[1]
type ErrorTerminal = Extract<Terminal, { type: "error" }>

const resolveTerminalErrorContext = (
  terminal: ErrorTerminal,
  options: TerminalOptions
) => {
  const { error } = terminal
  const isProviderError = error.kind === "provider"
  const providerId =
    error.providerId || (isProviderError ? options.providerId : undefined)
  const providerName =
    error.providerName ||
    (providerId ? getProviderDisplayName(providerId) : undefined)
  return {
    isProviderError,
    providerId,
    providerName,
    model: error.model || options.model
  }
}

export const useChatStream = ({
  setMessages,
  setIsLoading,
  setIsStreaming,
  onToken,
  onSuccessfulResponse
}: UseChatStreamProps) => {
  const { t } = useTranslation()
  const { toast } = useToast()
  const sessionRef = useRef<ChatStreamSession | null>(null)

  // oxlint-disable-next-line react/refs -- Safe lazy initialization: the constructor only stores ports and does not connect or mutate external state.
  if (!sessionRef.current) {
    sessionRef.current = new ChatStreamSession({
      connectPort: createPort,
      schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
      createRequestId,
      getLastDisconnectError: () => browser.runtime.lastError?.message
    })
  }
  const session = sessionRef.current

  const renderAssistant = (
    assistant: ChatMessage,
    options: ChatStreamStartOptions
  ) => setMessages([...options.messages, assistant])

  const handleErrorTerminal = (
    terminal: ErrorTerminal,
    options: TerminalOptions
  ): void => {
    const { error, partial } = terminal
    const context = resolveTerminalErrorContext(terminal, options)
    const provider = context.providerName || t("chat.errors.provider_fallback")
    const localizedUserMessage = error.messageKey
      ? t(error.messageKey, {
          provider,
          model: context.model || t("chat.errors.model_fallback"),
          setupGuideUrl: EXTERNAL_URLS.SETUP_GUIDE
        })
      : error.userMessage
    const message = getDisplayErrorMessage(error) || t("chat.errors.no_message")
    const errMsg =
      localizedUserMessage ??
      (context.isProviderError && error.status > 0
        ? providerErrorUserMessage(error.status, {
            providerName: context.providerName,
            model: context.model,
            baseUrl: error.baseUrl
          })
        : context.providerName
          ? t("chat.errors.unknown_error", { message, provider })
          : t("chat.errors.unknown_error_generic", { message }))

    /*
     * The failure is rendered as the assistant's own bubble, with its retry
     * and issue-report actions. No toast: it would only repeat that bubble.
     */
    void renderAssistant(
      {
        ...partial,
        content: errMsg,
        done: true,
        error: {
          status: error.status,
          kind: error.kind,
          retryable: error.retryable,
          retryAfterMs: error.retryAfterMs,
          userMessage: errMsg,
          providerId: context.providerId,
          providerName: context.providerName,
          model: context.model,
          baseUrl: error.baseUrl,
          code: error.code,
          phase: error.phase,
          incidentId: error.incidentId,
          durationMs: error.durationMs,
          recoveryAction: error.recoveryAction
        }
      },
      options
    )
  }

  const handleSuccessTerminal = (
    terminal: Exclude<Terminal, { type: "error" }>,
    options: TerminalOptions
  ): void => {
    const message = terminal.emptyReason
      ? {
          ...terminal.message,
          content:
            terminal.emptyReason === "thinking-only"
              ? t("chat.errors.thinking_only_response")
              : t("chat.errors.empty_response")
        }
      : terminal.message
    Promise.resolve(renderAssistant(message, options))
      .then(async () => {
        await onSuccessfulResponse?.(message)
      })
      .catch((error) => {
        logger.debug(
          "Successful response persistence finalization failed",
          "useChatStream",
          { error }
        )
      })
  }

  const callbacks: ChatStreamSessionCallbacks = {
    onAssistant: renderAssistant,
    onActivityChange: ({ loading, streaming }) => {
      setIsLoading(loading)
      setIsStreaming(streaming)
    },
    onToken,
    onWarning: (warning) => {
      if (!warning.titleKey) return
      toast({
        variant: warning.variant,
        title: t(warning.titleKey),
        description: warning.descriptionKey
          ? t(warning.descriptionKey, warning.descriptionValues)
          : undefined
      })
    },
    onInvalidEvent: (issueCount) => {
      logger.warn("Dropped invalid chat stream event", "StreamProtocol", {
        issues: issueCount
      })
    },
    onStartRejected: (requestId) => {
      if (requestId) {
        logger.warn(
          "Ignored stream start while another request is active",
          "useChatStream",
          { requestId }
        )
      } else {
        logger.warn("Ignored stream start without ownership", "useChatStream")
      }
    },
    onStopWithoutActiveStream: () => {
      logger.warn("Stop requested but port not created yet", "useChatStream")
    },
    onStopError: (error) => {
      logger.error("Failed to send stop message", "useChatStream", { error })
    },
    onDisconnectError: (error) => {
      logger.debug("Port disconnected unexpectedly", "useChatStream", {
        error
      })
    },
    onTerminal: (terminal, options) => {
      if (terminal.type === "error") {
        handleErrorTerminal(terminal, options)
        return
      }
      handleSuccessTerminal(terminal, options)
    }
  }
  useLayoutEffect(() => {
    session.updateCallbacks(callbacks)
  })

  return {
    startStream: (
      options: ChatStreamStartOptions,
      claim?: import("@/application/turns/chat-stream-session").ChatStreamClaim
    ) => session.start(options, claim),
    stopStream: () => session.stop(),
    claimStream: () => session.claimStream(),
    releaseStreamClaim: (
      claim: import("@/application/turns/chat-stream-session").ChatStreamClaim
    ) => session.releaseStreamClaim(claim)
  }
}
