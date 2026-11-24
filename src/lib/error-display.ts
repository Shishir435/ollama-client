import {
  type AppErrorKind,
  getErrorMessage,
  isAppError
} from "@/lib/error-utils"
import { providerErrorUserMessage } from "@/lib/providers/provider-errors"

/** Raw provider bodies look like `Ollama Error (404): {"error":…}` — never UI copy. */
const looksLikeRawProviderError = (message: string): boolean =>
  /error \(\d{3}\)|\{"error"/i.test(message)

type ErrorEnvelope = {
  status?: number
  message?: string
  kind?: AppErrorKind
  userMessage?: string
  retryable?: boolean
  retryAfterMs?: number
  context?: string
  providerId?: string
}

/** The translator these helpers need; a React `t` satisfies it. */
export type ErrorTranslate = (key: string) => string

/** Kinds that carry an `errors.display.hint.*` and `.title.*` of their own. */
const DISPLAY_KINDS: readonly AppErrorKind[] = [
  "network",
  "provider",
  "storage",
  "validation",
  "abort"
]

const hasDisplayCopy = (kind?: AppErrorKind): kind is AppErrorKind =>
  kind !== undefined && DISPLAY_KINDS.includes(kind)

const sentence = (value: string) =>
  /[.!?。！？]$/.test(value.trim()) ? value.trim() : `${value.trim()}.`

/**
 * The message to show for an error. `fallbackMessage` is the caller's own
 * translated text for "nothing displayable"; omitted, an unreadable error
 * yields an empty string so the caller can choose what to say.
 */
export const getDisplayErrorMessage = (
  error: unknown,
  fallbackMessage = ""
) => {
  if (typeof error === "string") return error || fallbackMessage
  if (isAppError(error)) {
    return (
      error.userMessage ||
      sanitizeErrorMessage(error.message, error.status) ||
      fallbackMessage
    )
  }
  if (error && typeof error === "object") {
    const envelope = error as ErrorEnvelope
    return (
      envelope.userMessage ||
      sanitizeErrorMessage(envelope.message, envelope.status) ||
      fallbackMessage
    )
  }

  return getErrorMessage(error, fallbackMessage)
}

/**
 * Last line of defense: if a raw provider response (status codes, JSON error
 * bodies) reaches the display layer without a `userMessage`, swap it for the
 * clean per-status copy. The raw text stays in logs/debug, not in the chat.
 */
const sanitizeErrorMessage = (
  message: string | undefined,
  status: number | undefined
): string | undefined => {
  if (!message) return message
  if (
    typeof status === "number" &&
    status > 0 &&
    looksLikeRawProviderError(message)
  ) {
    return providerErrorUserMessage(status)
  }
  return message
}

export const formatErrorForDisplay = (
  error: unknown,
  t: ErrorTranslate,
  fallbackMessage = t("errors.display.generic")
) => {
  const envelope =
    error && typeof error === "object" ? (error as ErrorEnvelope) : {}
  const kind = isAppError(error) ? error.kind : envelope.kind
  const retryable = isAppError(error) ? error.retryable : envelope.retryable
  const baseMessage = getDisplayErrorMessage(error, fallbackMessage)
  const hint = hasDisplayCopy(kind)
    ? t(`errors.display.hint.${kind}`)
    : undefined
  const retryHint = retryable ? t("errors.display.retryable") : undefined
  const details = [hint, retryHint].filter(Boolean).join(" ")

  return {
    title: t(`errors.display.title.${hasDisplayCopy(kind) ? kind : "default"}`),
    message: details ? `${sentence(baseMessage)} ${details}` : baseMessage,
    rawMessage: baseMessage,
    kind,
    retryable: Boolean(retryable)
  }
}
