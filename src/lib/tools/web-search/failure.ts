import { isNamedError } from "@/lib/error-utils"
import { WebSearchError, type WebSearchProviderId } from "./types"

/** Why a search could not be run, in terms a user can act on. */
export type WebSearchFailureKind =
  | "unreachable"
  | "timeout"
  | "auth"
  | "forbidden"
  | "not-found"
  | "rate-limited"
  | "http"
  | "not-json"

/** The i18n key under `settings.web_search.failures` naming each kind's fix. */
const KEY_BY_KIND: Record<WebSearchFailureKind, string> = {
  unreachable: "settings.web_search.failures.unreachable",
  timeout: "settings.web_search.failures.timeout",
  auth: "settings.web_search.failures.auth",
  forbidden: "settings.web_search.failures.forbidden",
  "not-found": "settings.web_search.failures.not_found",
  "rate-limited": "settings.web_search.failures.rate_limited",
  http: "settings.web_search.failures.http",
  "not-json": "settings.web_search.failures.not_json"
}

/** A local SearXNG that is simply not running gets the one-command setup. */
const SEARXNG_UNREACHABLE_KEY =
  "settings.web_search.failures.searxng_unreachable"

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/i

const isLocalEndpoint = (endpoint?: string): boolean => {
  if (!endpoint) return false
  try {
    return LOCAL_HOST.test(new URL(endpoint).hostname)
  } catch {
    return false
  }
}

const kindForStatus = (
  status: number,
  provider: string
): WebSearchFailureKind => {
  if (status === 401) return "auth"
  if (status === 403) return provider === "SearXNG" ? "not-json" : "forbidden"
  if (status === 404) return "not-found"
  if (status === 429) return "rate-limited"
  if (status === 408 || status === 504) return "timeout"
  return "http"
}

/**
 * A non-2xx answer from a search backend. SearXNG's 403 is the stock
 * `search.formats` refusal of `format=json`, so it keeps that backend's own
 * copy; everyone else's names the status.
 */
export const webSearchHttpError = (
  provider: string,
  status: number
): WebSearchError => {
  const kind = kindForStatus(status, provider)
  const key =
    provider === "SearXNG" && kind === "not-json"
      ? "settings.web_search.errors.searxng_json_disabled"
      : KEY_BY_KIND[kind]
  return new WebSearchError(
    `${provider} search failed with HTTP ${status}`,
    key,
    { status }
  )
}

/**
 * Turn whatever a search threw into an error the settings test can explain.
 * A backend's own classified error passes through; a fetch that never got an
 * answer is the one thing no backend can classify itself, so it is sorted
 * here: a deadline, or nothing listening there.
 */
export const toWebSearchError = (
  error: unknown,
  context: { provider: WebSearchProviderId; endpoint?: string }
): WebSearchError | undefined => {
  if (error instanceof WebSearchError) return error
  if (
    isNamedError(error, "TimeoutError") ||
    (error instanceof DOMException && error.name === "TimeoutError")
  ) {
    return new WebSearchError("Web search timed out", KEY_BY_KIND.timeout)
  }
  const message = error instanceof Error ? error.message : String(error)
  if (/failed to fetch|networkerror|load failed|fetch failed/i.test(message)) {
    const key =
      context.provider === "searxng" && isLocalEndpoint(context.endpoint)
        ? SEARXNG_UNREACHABLE_KEY
        : KEY_BY_KIND.unreachable
    return new WebSearchError(`Web search backend is unreachable`, key)
  }
  return undefined
}
