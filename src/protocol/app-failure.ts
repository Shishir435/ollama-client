import { z } from "zod"
import { getErrorMessage, isAbortError, isAppError } from "@/lib/error-utils"

export const AppFailureSchema = z.object({
  status: z.number().int().nonnegative(),
  message: z.string(),
  kind: z
    .enum(["network", "provider", "storage", "validation", "abort", "unknown"])
    .optional(),
  messageKey: z.string().optional(),
  userMessage: z.string().optional(),
  retryable: z.boolean().optional(),
  retryAfterMs: z.number().nonnegative().optional(),
  context: z.string().optional(),
  providerId: z.string().optional(),
  providerName: z.string().optional(),
  model: z.string().optional(),
  baseUrl: z.string().optional(),
  code: z
    .enum([
      "OLC-PROVIDER-DISABLED",
      "OLC-PROVIDER-UNREACHABLE",
      "OLC-PROVIDER-HTTP",
      "OLC-MODEL-NOT-FOUND",
      "OLC-RESOURCE-NOT-FOUND",
      "OLC-MODEL-NOT-LOADED",
      "OLC-CORS-BLOCKED",
      "OLC-AUTH-FAILED",
      "OLC-PAYMENT-REQUIRED",
      "OLC-CONTEXT-TOO-LARGE",
      "OLC-INPUT-UNSUPPORTED",
      "OLC-OUT-OF-MEMORY",
      "OLC-MODEL-LOADING",
      "OLC-RATE-LIMITED",
      "OLC-PROVIDER-OVERLOADED",
      "OLC-PROVIDER-TIMEOUT",
      "OLC-STREAM-DROPPED",
      "OLC-UNKNOWN"
    ])
    .optional(),
  phase: z
    .enum([
      "configuration",
      "connect",
      "response",
      "read-stream",
      "tool",
      "persistence",
      "unknown"
    ])
    .optional(),
  incidentId: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  recoveryAction: z
    .enum([
      "retry",
      "enable-provider",
      "test-connection",
      "choose-model",
      "reduce-input",
      "wait-retry",
      "open-diagnostics"
    ])
    .optional()
})

export type AppFailure = z.infer<typeof AppFailureSchema>

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
