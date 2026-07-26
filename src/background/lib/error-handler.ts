import { recordDiagnosticEvent } from "@/lib/diagnostics/diagnostic-recorder"
import { getErrorMessage, isAbortError, isAppError } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import {
  applyProviderErrorContext,
  type ProviderErrorContext
} from "@/lib/providers/provider-errors"
import type {
  ChromePort,
  ChromeResponse,
  NetworkError,
  PortStatusFunction
} from "@/types"
import { safePostMessage } from "./utils"

type HandlerFunction<T> = (
  msg: T,
  port: ChromePort,
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
}

type ErrorEnvelope = NonNullable<ChromeResponse["error"]>

type ErrorEnvelopeOptions = {
  status?: number
  fallbackMessage?: string
  context?: string
  providerId?: string
}

export const normalizeError = (
  error: unknown,
  options: ErrorEnvelopeOptions = {}
): ErrorEnvelope => {
  const networkError =
    error && typeof error === "object" ? (error as Partial<NetworkError>) : {}
  const message =
    isAppError(error) && error.userMessage
      ? error.userMessage.trim()
      : getErrorMessage(error, options.fallbackMessage).trim()

  return {
    status: options.status ?? networkError.status ?? 0,
    message,
    ...(isAppError(error) && { kind: error.kind }),
    ...(isAppError(error) &&
      error.messageKey && { messageKey: error.messageKey }),
    ...(isAppError(error) &&
      error.userMessage && { userMessage: error.userMessage }),
    ...(isAppError(error) &&
      error.retryable !== undefined && { retryable: error.retryable }),
    ...(isAppError(error) &&
      error.retryAfterMs !== undefined && { retryAfterMs: error.retryAfterMs }),
    ...(options.context && { context: options.context }),
    ...(!options.context &&
      isAppError(error) &&
      error.context && {
        context: error.context
      }),
    ...(options.providerId && { providerId: options.providerId }),
    ...(!options.providerId &&
      isAppError(error) &&
      error.providerId && {
        providerId: error.providerId
      }),
    ...(isAppError(error) &&
      error.providerName && { providerName: error.providerName }),
    ...(isAppError(error) && error.model && { model: error.model }),
    ...(isAppError(error) && error.baseUrl && { baseUrl: error.baseUrl }),
    ...(isAppError(error) && { code: error.code }),
    ...(isAppError(error) && { phase: error.phase }),
    ...(isAppError(error) && { incidentId: error.incidentId }),
    ...(isAppError(error) &&
      error.durationMs !== undefined && { durationMs: error.durationMs }),
    ...(isAppError(error) &&
      error.recoveryAction && { recoveryAction: error.recoveryAction })
  }
}

export const createErrorResponse = (
  error: unknown,
  options: ErrorEnvelopeOptions = {}
): ChromeResponse => ({
  success: false,
  error: normalizeError(error, options)
})

/**
 * Higher-order function to wrap background message handlers with:
 * 1. Standardized error handling (AbortError vs Generic Error)
 * 2. Port closed checks
 * 3. Contextual error logging
 *
 * Each handler manages its own AbortController lifecycle (register + clear
 * in its own finally, under its own key). No cleanup happens here: this
 * wrapper doesn't know the handler's abort key, and clearing by `port.name`
 * used to delete the wrong entry while leaking the real one.
 */
export const withErrorContext = <T>(
  handler: HandlerFunction<T>,
  context: ErrorContext<T>
) => {
  return async (msg: T, port: ChromePort, isPortClosed: PortStatusFunction) => {
    const startedAt = performance.now()
    try {
      await handler(msg, port, isPortClosed)
    } catch (err) {
      // 3. Handle AbortError specifically
      if (isAbortError(err)) {
        if (!isPortClosed()) {
          safePostMessage(port, { done: true, aborted: true })
        }
        return
      }

      let reportedError = err
      if (isAppError(reportedError) && reportedError.durationMs === undefined) {
        reportedError.durationMs = Math.max(0, performance.now() - startedAt)
      }
      if (
        isAppError(err) &&
        err.kind === "provider" &&
        context.resolveProviderErrorContext
      ) {
        try {
          const providerContext = await context.resolveProviderErrorContext(msg)
          if (providerContext) {
            reportedError = applyProviderErrorContext(err, providerContext)
          }
        } catch (contextError) {
          logger.debug(
            "Failed to resolve provider error context",
            context.handler,
            { error: contextError }
          )
        }
      }

      // 4. Handle generic errors with enhanced logging
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
            err instanceof Error &&
            (!isAppError(err) || err.kind !== "provider")
              ? err.stack
              : undefined
        }
      )

      if (!isPortClosed()) {
        const response = createErrorResponse(reportedError, {
          status:
            reportedError &&
            typeof reportedError === "object" &&
            "status" in reportedError
              ? ((reportedError as Partial<NetworkError>).status ?? 500)
              : 500,
          context: `${context.handler}${context.operation ? ` - ${context.operation}` : ""}`,
          providerId: context.providerId
        })
        if (isAppError(reportedError)) {
          void recordDiagnosticEvent({
            level: "error",
            code: "REQUEST_FAILED",
            operation: (context.operation || context.handler)
              .replaceAll(" ", "-")
              .slice(0, 100),
            surface: "background",
            status: reportedError.status,
            retryable: reportedError.retryable,
            supportCode: reportedError.incidentId,
            durationMs: reportedError.durationMs,
            metadata: {
              errorCode: reportedError.code,
              phase: reportedError.phase
            }
          }).catch(() => undefined)
        }
        safePostMessage(port, { error: response.error })
      }
    }
  }
}
