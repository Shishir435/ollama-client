import {
  type AppErrorKind,
  getErrorMessage,
  isAppError
} from "@/lib/error-utils"

type ErrorEnvelope = {
  status?: number
  message?: string
  kind?: AppErrorKind
  userMessage?: string
  retryable?: boolean
  context?: string
  providerId?: string
}

const KIND_HINTS: Partial<Record<AppErrorKind, string>> = {
  network:
    "Check that the provider server is running and the URL is reachable.",
  provider: "Check the selected provider, model, and provider logs.",
  storage: "Try again after refreshing. If it persists, export diagnostics.",
  validation: "Review the input and try again.",
  abort: "The operation was cancelled."
}

const titleFromKind = (kind?: AppErrorKind) => {
  switch (kind) {
    case "network":
      return "Network error"
    case "provider":
      return "Provider error"
    case "storage":
      return "Storage error"
    case "validation":
      return "Invalid input"
    case "abort":
      return "Cancelled"
    default:
      return "Error"
  }
}

const sentence = (value: string) =>
  /[.!?]$/.test(value.trim()) ? value.trim() : `${value.trim()}.`

export const getDisplayErrorMessage = (
  error: unknown,
  fallbackMessage = "Something went wrong"
) => {
  if (typeof error === "string") return error || fallbackMessage
  if (isAppError(error)) {
    return error.userMessage || error.message || fallbackMessage
  }
  if (error && typeof error === "object") {
    const envelope = error as ErrorEnvelope
    return envelope.userMessage || envelope.message || fallbackMessage
  }

  return getErrorMessage(error, fallbackMessage)
}

export const formatErrorForDisplay = (
  error: unknown,
  fallbackMessage = "Something went wrong"
) => {
  const envelope =
    error && typeof error === "object" ? (error as ErrorEnvelope) : {}
  const kind = isAppError(error) ? error.kind : envelope.kind
  const retryable = isAppError(error) ? error.retryable : envelope.retryable
  const baseMessage = getDisplayErrorMessage(error, fallbackMessage)
  const hint = kind ? KIND_HINTS[kind] : undefined
  const retryHint = retryable ? "This may be temporary; try again." : undefined
  const details = [hint, retryHint].filter(Boolean).join(" ")

  return {
    title: titleFromKind(kind),
    message: details ? `${sentence(baseMessage)} ${details}` : baseMessage,
    rawMessage: baseMessage,
    kind,
    retryable: Boolean(retryable)
  }
}
