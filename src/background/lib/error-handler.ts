import type { AppFailure } from "@ollama-client/contracts/app-failure"
import { recordDiagnosticEvent } from "@/lib/diagnostics/diagnostic-recorder"
import { getErrorMessage, isAbortError, isAppError } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import {
  applyProviderErrorContext,
  type ProviderErrorContext
} from "@/lib/providers/provider-errors"
import { toAppFailure } from "@/protocol/app-failure"
import { CHAT_STREAM_EVENT_TYPES } from "@/protocol/streams"
import type {
  ChatStreamSink,
  ChromePort,
  ChromeResponse,
  NetworkError,
  PortStatusFunction
} from "@/types"
import { safePostChatStreamEvent } from "./runtime-delivery"

type HandlerFunction<T, TPort extends ChatStreamSink> = (
  msg: T,
  port: TPort,
  isPortClosed: PortStatusFunction
) => Promise<void>

interface ErrorContext<T> {
  handler: string
  operation?: string
  modelId?: string
  providerId?: string
  resolveProviderErrorContext?: (
    msg: T
  ) => Promise<ProviderErrorContext | undefined>
  resolveDiagnosticSessionId?: (msg: T) => string | undefined
}

type ErrorEnvelopeOptions = {
  status?: number
  fallbackMessage?: string
  context?: string
  providerId?: string
}

export const normalizeError = (
  error: unknown,
  options: ErrorEnvelopeOptions = {}
): AppFailure => toAppFailure(error, options)

export const createErrorResponse = (
  error: unknown,
  options: ErrorEnvelopeOptions = {}
): ChromeResponse => ({
  success: false,
  error: normalizeError(error, options)
})

const resolveReportedError = async <T>(
  error: unknown,
  msg: T,
  context: ErrorContext<T>,
  startedAt: number
): Promise<unknown> => {
  const reportedError = error
  if (isAppError(reportedError) && reportedError.durationMs === undefined) {
    reportedError.durationMs = Math.max(0, performance.now() - startedAt)
  }
  if (
    !isAppError(error) ||
    error.kind !== "provider" ||
    !context.resolveProviderErrorContext
  ) {
    return reportedError
  }

  try {
    const providerContext = await context.resolveProviderErrorContext(msg)
    return providerContext
      ? applyProviderErrorContext(error, providerContext)
      : reportedError
  } catch (contextError) {
    logger.debug("Failed to resolve provider error context", context.handler, {
      error: contextError
    })
    return reportedError
  }
}

const logReportedError = <T>(
  originalError: unknown,
  reportedError: unknown,
  context: ErrorContext<T>
): void => {
  const isProviderError =
    isAppError(originalError) && originalError.kind === "provider"
  logger.error(
    `Error during ${context.operation || "operation"}`,
    context.handler,
    {
      message:
        isAppError(reportedError) && reportedError.userMessage
          ? reportedError.userMessage
          : getErrorMessage(reportedError),
      model: context.modelId,
      provider: context.providerId,
      stack:
        originalError instanceof Error && !isProviderError
          ? originalError.stack
          : undefined
    }
  )
}

const statusOf = (error: unknown): number => {
  if (!error || typeof error !== "object" || !("status" in error)) return 500
  return (error as Partial<NetworkError>).status ?? 500
}

const recordAppDiagnostic = async <T>(
  error: unknown,
  msg: T,
  context: ErrorContext<T>
): Promise<void> => {
  if (!isAppError(error)) return
  const sessionId = context.resolveDiagnosticSessionId?.(msg)
  await recordDiagnosticEvent({
    level: "error",
    code: "REQUEST_FAILED",
    operation: (context.operation || context.handler)
      .replaceAll(" ", "-")
      .slice(0, 100),
    surface: "background",
    status: error.status,
    retryable: error.retryable,
    supportCode: error.incidentId,
    ...(sessionId && { sessionId }),
    durationMs: error.durationMs,
    metadata: {
      errorCode: error.code,
      phase: error.phase
    }
  }).catch(() => undefined)
}

const sendAbort = <TPort extends ChatStreamSink>(port: TPort): void => {
  safePostChatStreamEvent(port, {
    version: 1,
    type: CHAT_STREAM_EVENT_TYPES.CHUNK,
    seq: port.streamSequence ?? 0,
    done: true,
    aborted: true
  })
}

const sendFailure = async <T, TPort extends ChatStreamSink>(
  reportedError: unknown,
  msg: T,
  port: TPort,
  context: ErrorContext<T>
): Promise<void> => {
  const response = createErrorResponse(reportedError, {
    status: statusOf(reportedError),
    context: `${context.handler}${context.operation ? ` - ${context.operation}` : ""}`,
    providerId: context.providerId
  })
  await recordAppDiagnostic(reportedError, msg, context)
  safePostChatStreamEvent(port, {
    version: 1,
    type: CHAT_STREAM_EVENT_TYPES.CHUNK,
    seq: port.streamSequence ?? 0,
    error: response.error
  })
}

/**
 * Higher-order function to wrap background message handlers with standardized
 * abort handling, provider context enrichment, diagnostics and stream delivery.
 */
export const withErrorContext = <T, TPort extends ChatStreamSink = ChromePort>(
  handler: HandlerFunction<T, TPort>,
  context: ErrorContext<T>
) => {
  return async (msg: T, port: TPort, isPortClosed: PortStatusFunction) => {
    const startedAt = performance.now()
    try {
      await handler(msg, port, isPortClosed)
    } catch (error) {
      if (isAbortError(error)) {
        if (!isPortClosed()) sendAbort(port)
        return
      }

      const reportedError = await resolveReportedError(
        error,
        msg,
        context,
        startedAt
      )
      logReportedError(error, reportedError, context)
      if (isPortClosed()) return
      await sendFailure(reportedError, msg, port, context)
    }
  }
}
