const DEFAULT_ERROR_MESSAGE = "An unexpected error occurred"

export type AppErrorKind =
  | "network"
  | "provider"
  | "storage"
  | "validation"
  | "abort"
  | "unknown"

export type AppErrorOptions = {
  kind?: AppErrorKind
  status?: number
  userMessage?: string
  retryable?: boolean
  context?: string
  providerId?: string
  debug?: unknown
  cause?: unknown
}

export class AppError extends Error {
  kind: AppErrorKind
  status?: number
  userMessage?: string
  retryable?: boolean
  context?: string
  providerId?: string
  debug?: unknown

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.name = "AppError"
    this.kind = options.kind || "unknown"
    this.status = options.status
    this.userMessage = options.userMessage
    this.retryable = options.retryable
    this.context = options.context
    this.providerId = options.providerId
    this.debug = options.debug
  }
}

export const createAppError = (
  message: string,
  options: AppErrorOptions = {}
) => new AppError(message, options)

export const isAppError = (error: unknown): error is AppError =>
  error instanceof AppError

export const getErrorMessage = (
  error: unknown,
  fallbackMessage = DEFAULT_ERROR_MESSAGE
) => {
  if (error instanceof Error) return error.message || fallbackMessage
  if (typeof error === "string") return error || fallbackMessage
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string" && message) return message
  }

  return fallbackMessage
}

export const isNamedError = (error: unknown, name: string) =>
  error instanceof Error
    ? error.name === name
    : !!(
        error &&
        typeof error === "object" &&
        "name" in error &&
        (error as { name?: unknown }).name === name
      )

export const isAbortError = (error: unknown) =>
  isNamedError(error, "AbortError")
