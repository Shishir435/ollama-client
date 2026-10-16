import {
  type AppError,
  createAppError,
  isAbortError,
  isAppError,
  isNamedError
} from "@/lib/error-utils"
import {
  forbiddenMayBeOriginBlock,
  isLocalProviderBaseUrl
} from "@/lib/providers/provider-errors"
import type { ProviderConfig } from "@/lib/providers/types"
import { ProviderType } from "@/lib/providers/types"

export const OLLAMA_CORS_COMMAND =
  'OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*" ollama serve'

/**
 * Why a connection test failed, in the terms a user can act on. A network
 * error cannot tell a stopped server from one that refused the extension
 * without a CORS header, so both stay one honest `unavailable` class.
 */
export type ProviderConnectionFailureKind =
  | "cors"
  | "refused"
  | "auth"
  | "not-found"
  | "timeout"
  | "unavailable"
  | "server-error"
  | "rate-limited"
  | "payment"

/** The i18n key under `onboarding.provider.errors` naming the Ollama origins fix. */
export const OLLAMA_CORS_MESSAGE_KEY = "onboarding.provider.errors.cors"

const statusOf = (error: unknown): number | undefined =>
  isAppError(error) ? error.status : undefined

/**
 * Sort a failed catalog request into one {@link ProviderConnectionFailureKind}.
 * Reads only the status and error class, never the provider's response text.
 */
export const classifyProviderConnectionFailure = (
  error: unknown,
  config:
    | (Pick<ProviderConfig, "baseUrl"> & Partial<Pick<ProviderConfig, "type">>)
    | undefined
): ProviderConnectionFailureKind => {
  if (
    isNamedError(error, "TimeoutError") ||
    (isAbortError(error) && !isAppError(error))
  ) {
    return "timeout"
  }
  if (isAppError(error) && error.code === "OLC-CORS-BLOCKED") return "cors"
  if (isAppError(error) && error.code === "OLC-PROVIDER-TIMEOUT")
    return "timeout"
  const status = statusOf(error)
  if (status === 401 || status === 403) {
    /**
     * Ollama sends no API key, and a local server has no account to reject.
     * Where the browser cannot remove `Origin`, a 401/403 from either is the
     * server refusing the extension's origin. Where it can, the server never
     * saw one, so the refusal is its own or a proxy's.
     */
    if (
      config?.type === ProviderType.OLLAMA ||
      isLocalProviderBaseUrl(config?.baseUrl)
    ) {
      return forbiddenMayBeOriginBlock() ? "cors" : "refused"
    }
    return "auth"
  }
  if (status === 429) return "rate-limited"
  if (status === 402) return "payment"
  if (status === 408 || status === 504) return "timeout"
  if (status === 404 || status === 400 || status === 405) return "not-found"
  if (status !== undefined && status >= 500) return "server-error"
  if (isAppError(error) && error.kind === "validation") return "not-found"
  if (status !== undefined && status > 0) return "server-error"
  return "unavailable"
}

/** The message key for a failure class; Ollama alone gets the origins command. */
export const providerConnectionFailureMessageKey = (
  kind: ProviderConnectionFailureKind,
  type: ProviderType | undefined
): string => {
  if (kind === "cors") {
    return type === ProviderType.OLLAMA
      ? OLLAMA_CORS_MESSAGE_KEY
      : "onboarding.provider.errors.cors-other"
  }
  return `onboarding.provider.errors.${kind}`
}

const FALLBACK_TEXT: Record<
  ProviderConnectionFailureKind,
  (provider: string) => string
> = {
  cors: (provider) =>
    `${provider} is running but blocked this extension. Allow chrome-extension://* and moz-extension://* in its CORS settings, then restart it.`,
  refused: (provider) =>
    `${provider} refused the request. Check the API key in provider settings, or the access rules of any proxy in front of it.`,
  auth: (provider) =>
    `${provider} rejected the API key. Check it in provider settings.`,
  "not-found": (provider) =>
    `Something answered, but it isn't ${provider}. Check the port and base URL.`,
  timeout: (provider) =>
    `${provider} took too long to answer. Check that it's running and the port is correct.`,
  unavailable: (provider) =>
    `Can't reach ${provider}. Start it, then retry. If it's running, check the base URL.`,
  "server-error": (provider) =>
    `${provider} hit a server error. Check its log, then retry.`,
  "rate-limited": (provider) =>
    `${provider} is limiting requests right now. Wait a moment, then retry.`,
  payment: (provider) =>
    `${provider} needs payment or credits. Check your account, then retry.`
}

/**
 * Turn a failed connection test into an error the RPC boundary can carry: a
 * class-specific message key with the provider's name, English fallback text,
 * and the original status. The raw cause stays in `debug`/`cause` only.
 */
export const providerConnectionError = (
  error: unknown,
  config: ProviderConfig | undefined,
  providerId: string
): AppError => {
  const kind = classifyProviderConnectionFailure(error, config)
  const provider = config?.name?.trim() || "The provider"
  const status = statusOf(error)
  return createAppError(`Provider connection test failed (${kind})`, {
    kind: "provider",
    ...(status !== undefined && status > 0 && { status }),
    providerId,
    providerName: config?.name,
    code:
      kind === "cors"
        ? "OLC-CORS-BLOCKED"
        : kind === "auth" || kind === "refused"
          ? "OLC-AUTH-FAILED"
          : kind === "timeout"
            ? "OLC-PROVIDER-TIMEOUT"
            : kind === "not-found"
              ? "OLC-RESOURCE-NOT-FOUND"
              : kind === "server-error"
                ? "OLC-PROVIDER-HTTP"
                : kind === "rate-limited"
                  ? "OLC-RATE-LIMITED"
                  : kind === "payment"
                    ? "OLC-PAYMENT-REQUIRED"
                    : "OLC-PROVIDER-UNREACHABLE",
    phase: "connect",
    recoveryAction: "test-connection",
    retryable:
      kind === "unavailable" || kind === "timeout" || kind === "rate-limited",
    messageKey: providerConnectionFailureMessageKey(kind, config?.type),
    messageParams: { provider },
    userMessage: FALLBACK_TEXT[kind](provider),
    debug: isAppError(error) ? error.message : String(error),
    cause: error
  })
}
