import {
  type AppFailure,
  AppFailureSchema
} from "@ollama-client/contracts/app-failure"
import { getErrorMessage, isAbortError, isAppError } from "@/lib/error-utils"

export { type AppFailure, AppFailureSchema }

interface ToAppFailureOptions {
  status?: number
  fallbackMessage?: string
  context?: string
  providerId?: string
}

export const toAppFailure = (
  error: unknown,
  options: ToAppFailureOptions = {}
): AppFailure => {
  const status =
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : undefined
  const message =
    isAppError(error) && error.userMessage
      ? error.userMessage.trim()
      : getErrorMessage(error, options.fallbackMessage).trim()

  return {
    status: options.status ?? status ?? 0,
    message,
    ...(isAppError(error) && { kind: error.kind }),
    ...(isAbortError(error) &&
      !isAppError(error) && { kind: "abort" as const }),
    ...(isAppError(error) &&
      error.messageKey && { messageKey: error.messageKey }),
    ...(isAppError(error) &&
      error.userMessage && { userMessage: error.userMessage }),
    ...(isAppError(error) &&
      error.retryable !== undefined && { retryable: error.retryable }),
    ...(isAppError(error) &&
      error.retryAfterMs !== undefined && { retryAfterMs: error.retryAfterMs }),
    ...((options.context || (isAppError(error) && error.context)) && {
      context:
        options.context || (isAppError(error) ? error.context : undefined)
    }),
    ...((options.providerId || (isAppError(error) && error.providerId)) && {
      providerId:
        options.providerId || (isAppError(error) ? error.providerId : undefined)
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
