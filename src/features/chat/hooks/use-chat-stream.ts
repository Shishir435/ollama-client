import { useRef } from "react"
import { useTranslation } from "react-i18next"
import {
  type ChatStreamPort,
  ChatStreamSession,
  type ChatStreamSessionCallbacks,
  type ChatStreamStartOptions
} from "@/application/turns/chat-stream-session"
import { useToast } from "@/hooks/use-toast"
import { browser } from "@/lib/browser-api"
import { ERROR_MESSAGES, MESSAGE_KEYS } from "@/lib/constants"
import {
  formatErrorForDisplay,
  getDisplayErrorMessage
} from "@/lib/error-display"
import { buildErrorReportUrl } from "@/lib/error-report"
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

/** React effects adapter for the framework-independent ChatStreamSession. */
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
        const { error, partial } = terminal
        const isProviderError = error.kind === "provider"
        const errorProviderId =
          error.providerId || (isProviderError ? options.providerId : undefined)
        const providerName =
          error.providerName ||
          (errorProviderId
            ? getProviderDisplayName(errorProviderId)
            : undefined)
        const errorModel = error.model || options.model
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
          (isProviderError && error.status > 0
            ? providerErrorUserMessage(error.status, {
                providerName,
                model: errorModel,
                baseUrl: error.baseUrl
              })
            : t("chat.errors.unknown_error", {
                message:
                  getDisplayErrorMessage(error) || t("chat.errors.no_message")
              }))
        const issueUrl =
          isProviderError && error.status >= 500
            ? buildErrorReportUrl({
                status: error.status,
                kind: error.kind,
                message: errMsg,
                providerId: errorProviderId,
                providerName,
                model: errorModel,
                baseUrl: error.baseUrl,
                code: error.code,
                phase: error.phase,
                incidentId: error.incidentId,
                durationMs: error.durationMs,
                recoveryAction: error.recoveryAction
              })
            : undefined
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
              providerId: errorProviderId,
              providerName,
              model: errorModel,
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
        toast({
          variant: "destructive",
          title: displayError.kind
            ? isProviderError && providerName
              ? `${providerName} error`
              : displayError.title
            : t("chat.errors.response_failed_title"),
          description:
            isProviderError && providerName
              ? `${displayError.message}${
                  error.retryable ? " This may be temporary; try again." : ""
                }`
              : displayError.message,
          ...(issueUrl && {
            action: {
              label: "Open new issue",
              onClick: () => {
                void browser.tabs.create({ url: issueUrl })
              }
            }
          })
        })
        return
      }

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
  }
  session.updateCallbacks(callbacks)

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
