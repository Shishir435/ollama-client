import {
  type AppError,
  createAppError,
  isAbortError,
  isAppError,
  isNamedError
} from "@/lib/error-utils"
import { resolveProviderBaseUrl } from "@/lib/providers/base-url"
import {
  forbiddenMayBeOriginBlock,
  isLocalProviderBaseUrl
} from "@/lib/providers/provider-errors"
import type { ProviderConfig } from "@/lib/providers/types"
import { ProviderType } from "@/lib/providers/types"

export const OLLAMA_CORS_COMMAND =
  'OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*" ollama serve'

export type OllamaHostOs = "macos" | "windows" | "linux"

/**
 * Per-OS way to give Ollama the extension origins. On macOS and Windows the
 * Ollama app owns the port, so a second `ollama serve` fails; the variable has
 * to reach the app instead, and the app must be restarted to read it.
 */
export const OLLAMA_ORIGINS_COMMANDS: Record<OllamaHostOs, string> = {
  macos:
    'launchctl setenv OLLAMA_ORIGINS "chrome-extension://*,moz-extension://*"',
  windows: 'setx OLLAMA_ORIGINS "chrome-extension://*,moz-extension://*"',
  linux: OLLAMA_CORS_COMMAND
}

/** Best guess of the user's OS for the origins instructions. */
export const detectOllamaHostOs = (userAgent?: string): OllamaHostOs => {
  const agent =
    userAgent ?? (typeof navigator === "undefined" ? "" : navigator.userAgent)
  if (/Windows/i.test(agent)) return "windows"
  if (/Mac/i.test(agent)) return "macos"
  return "linux"
}

/**
 * Why a connection test failed, in the terms a user can act on. A refusal the
 * server sends (401/403) is `cors` where the browser cannot hide the extension's
 * `Origin`. A bare network error cannot tell a stopped server from one that
 * refused the extension, so it stays `unavailable` — unless a second, bare
 * request to the same host was answered, which is {@link
 * ProviderConnectionEvidence.listening}: something is running there and only
 * the extension's request failed, reported as `blocked`.
 */
export type ProviderConnectionFailureKind =
  | "cors"
  | "blocked"
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

/** The key for a server that answers a bare request but not the extension's. */
export const OLLAMA_BLOCKED_MESSAGE_KEY = "onboarding.provider.errors.blocked"

/** Whether a failure's message key is one the Ollama origins command fixes. */
export const isOriginsFixMessageKey = (key: string | undefined): boolean =>
  key === OLLAMA_CORS_MESSAGE_KEY || key === OLLAMA_BLOCKED_MESSAGE_KEY

/** What was learned about the host beyond the failed request itself. */
export interface ProviderConnectionEvidence {
  /** A request with no extension-specific headers was answered by the host. */
  listening?: boolean
}

const PROBE_TIMEOUT_MS = 2_000

/**
 * Ask the host's root with a bare, no-CORS request: it settles only when
 * something is listening, and a refused connection rejects. The response is
 * opaque and never read. Reaching here means the real request already failed
 * at the network level, so this separates "nothing is there" from "something
 * is there and refused the extension" — the two a `TypeError` cannot tell apart.
 */
export const probeHostListening = async (
  baseUrl: string | undefined,
  signal?: AbortSignal
): Promise<boolean> => {
  if (!baseUrl || signal?.aborted) return false
  let target: string
  try {
    target = new URL("/", baseUrl).toString()
  } catch {
    return false
  }
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS)
  try {
    await fetch(target, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      credentials: "omit",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    })
    return true
  } catch {
    return false
  }
}

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
    | undefined,
  evidence?: ProviderConnectionEvidence
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
  if (
    evidence?.listening &&
    (config?.type === ProviderType.OLLAMA ||
      isLocalProviderBaseUrl(config?.baseUrl))
  ) {
    return "blocked"
  }
  return "unavailable"
}

/** The message key for a failure class; Ollama alone gets the origins command. */
export const providerConnectionFailureMessageKey = (
  kind: ProviderConnectionFailureKind,
  type: ProviderType | undefined
): string => {
  if (kind === "blocked") {
    return type === ProviderType.OLLAMA
      ? OLLAMA_BLOCKED_MESSAGE_KEY
      : "onboarding.provider.errors.blocked-other"
  }
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
  blocked: (provider) =>
    `Something is running at ${provider}'s address but refused this extension. It may be blocking the extension's origin: allow chrome-extension://* and moz-extension://* in its CORS settings, then restart it.`,
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
  providerId: string,
  evidence?: ProviderConnectionEvidence
): AppError => {
  const kind = classifyProviderConnectionFailure(error, config, evidence)
  const provider = config?.name?.trim() || "The provider"
  const status = statusOf(error)
  return createAppError(`Provider connection test failed (${kind})`, {
    kind: "provider",
    ...(status !== undefined && status > 0 && { status }),
    providerId,
    providerName: config?.name,
    code:
      kind === "cors" || kind === "blocked"
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

/**
 * The URL the failed request went to. A built-in provider left on its default
 * stores no `baseUrl`; probing that undefined value always read as "nothing
 * listening", so a running Ollama that refused the extension was reported as
 * stopped.
 */
const probeTarget = (
  config: ProviderConfig | undefined
): string | undefined => {
  if (!config) return undefined
  try {
    return resolveProviderBaseUrl(config)
  } catch {
    return undefined
  }
}

/**
 * {@link providerConnectionError} for a failure that may be a bare network
 * error: when it is, and the host is local or Ollama, asks the host whether
 * anything is listening so a stopped server and a refusing one read
 * differently. Every other failure is classified from the error alone.
 */
export const diagnoseProviderConnectionFailure = async (
  error: unknown,
  config: ProviderConfig | undefined,
  providerId: string,
  signal?: AbortSignal
): Promise<AppError> => {
  const probeable =
    classifyProviderConnectionFailure(error, config) === "unavailable" &&
    (config?.type === ProviderType.OLLAMA ||
      isLocalProviderBaseUrl(config?.baseUrl))
  const evidence: ProviderConnectionEvidence | undefined = probeable
    ? { listening: await probeHostListening(probeTarget(config), signal) }
    : undefined
  return providerConnectionError(error, config, providerId, evidence)
}
