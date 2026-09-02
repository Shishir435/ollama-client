import type { AppFailure } from "@ollama-client/contracts/app-failure"
import { getErrorMessage, isAbortError, isAppError } from "@/lib/error-utils"

interface ToAppFailureOptions {
  status?: number
  fallbackMessage?: string
  context?: string
  providerId?: string
}

const getErrorStatus = (error: unknown): number | undefined => {
  if (!error || typeof error !== "object" || !("status" in error)) {
    return undefined
  }
  return typeof error.status === "number" ? error.status : undefined
}

const omitUndefined = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T

export const toAppFailure = (
  error: unknown,
  options: ToAppFailureOptions = {}
): AppFailure => {
  const appError = isAppError(error) ? error : undefined
  const message = appError?.userMessage
    ? appError.userMessage.trim()
    : getErrorMessage(error, options.fallbackMessage).trim()

  return omitUndefined({
    status: options.status ?? getErrorStatus(error) ?? 0,
    message,
    kind: appError?.kind ?? (isAbortError(error) ? "abort" : undefined),
    messageKey: appError?.messageKey,
    userMessage: appError?.userMessage,
    retryable: appError?.retryable,
    retryAfterMs: appError?.retryAfterMs,
    context: options.context ?? appError?.context,
    providerId: options.providerId ?? appError?.providerId,
    providerName: appError?.providerName,
    model: appError?.model,
    baseUrl: appError?.baseUrl,
    code: appError?.code,
    phase: appError?.phase,
    incidentId: appError?.incidentId,
    durationMs: appError?.durationMs,
    recoveryAction: appError?.recoveryAction
  }) as AppFailure
}
