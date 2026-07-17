import { getErrorMessage, isAbortError, isAppError } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
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

interface ErrorContext {
  handler: string
  operation?: string
  modelId?: string
  providerId?: string
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
  const message = getErrorMessage(error, options.fallbackMessage).trim()

  return {
    status: options.status ?? networkError.status ?? 0,
    message,
    ...(isAppError(error) && { kind: error.kind }),
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
      })
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
  context: ErrorContext
) => {
  return async (msg: T, port: ChromePort, isPortClosed: PortStatusFunction) => {
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

      // 4. Handle generic errors with enhanced logging
      logger.error(
        `Error during ${context.operation || "operation"}`,
        context.handler,
        {
          message: getErrorMessage(err),
          model: context.modelId,
          provider: context.providerId,
          stack: err instanceof Error ? err.stack : undefined
        }
      )

      if (!isPortClosed()) {
        const response = createErrorResponse(err, {
          status:
            err && typeof err === "object" && "status" in err
              ? ((err as Partial<NetworkError>).status ?? 500)
              : 500,
          context: `${context.handler}${context.operation ? ` - ${context.operation}` : ""}`,
          providerId: context.providerId
        })
        safePostMessage(port, { error: response.error })
      }
    }
  }
}
