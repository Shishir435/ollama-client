import type { WebRequest } from "webextension-polyfill"
import { browser, supportsWebRequestHeaders } from "@/lib/browser-api"
import { providerOrigins } from "@/lib/dnr-rules"

/**
 * Firefox's counterpart to the Chromium Origin rules in `dnr-rules.ts`.
 *
 * Firefox MV2 has no `declarativeNetRequest` here, so the extension's POSTs
 * to a provider carry `Origin: moz-extension://<uuid>` and Ollama — or a proxy
 * in front of it — answers 403 (#464). A blocking `onBeforeSendHeaders`
 * listener removes the header under the same two conditions the Chromium
 * rules use: the request was made by this extension, and it goes to a
 * configured provider origin. Requests from web pages and other extensions
 * are never touched, and neither are requests to anything else.
 *
 * The origin set is computed by `providerOrigins`, the same function the
 * Chromium reconcile uses, and is replaced by the same triggers.
 */

type HeaderDetails = Pick<
  WebRequest.OnBeforeSendHeadersDetailsType,
  "url" | "originUrl" | "documentUrl" | "requestHeaders"
>

let strippedOrigins = new Set<string>()
/**
 * The reconciled set and the draft origins connection tests are holding,
 * kept apart so a reconcile never drops a test's origin mid-test and a
 * finished test never leaves its origin behind.
 */
let configuredOrigins: string[] = []
const draftOrigins = new Map<string, number>()
let registered:
  | ((details: HeaderDetails) => WebRequest.BlockingResponse)
  | undefined

/** Whether this browser can run the listener: Firefox with the permission. */
export const supportsOriginStripListener = (): boolean =>
  supportsWebRequestHeaders()

/**
 * `moz-extension://<this extension's uuid>/`. Every page, background page and
 * worker of this extension reports a URL under it as the request's origin;
 * a web page, or another extension, cannot.
 */
const ownExtensionPrefix = (): string => browser.runtime.getURL("")

/** Whether the request was made by this extension. */
export const isOwnExtensionRequest = (
  details: Pick<HeaderDetails, "originUrl" | "documentUrl">
): boolean => {
  const prefix = ownExtensionPrefix()
  if (!prefix) return false
  const initiator = details.originUrl ?? details.documentUrl
  return typeof initiator === "string" && initiator.startsWith(prefix)
}

const requestOrigin = (url: string): string | undefined => {
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

/**
 * The listener itself, exported for tests. Returns an empty response —
 * "change nothing" — for anything outside the two conditions.
 */
export const stripProviderOrigin = (
  details: HeaderDetails
): WebRequest.BlockingResponse => {
  if (strippedOrigins.size === 0 || !details.requestHeaders) return {}
  if (!isOwnExtensionRequest(details)) return {}
  const origin = requestOrigin(details.url)
  if (!origin || !strippedOrigins.has(origin)) return {}
  const requestHeaders = details.requestHeaders.filter(
    (header) => header.name.toLowerCase() !== "origin"
  )
  if (requestHeaders.length === details.requestHeaders.length) return {}
  return { requestHeaders }
}

/**
 * Match patterns carry no port, so one pattern per scheme and host covers
 * every port on it; the listener compares the exact origin itself. Narrowing
 * the filter matters: a blocking listener holds every request it matches
 * until the extension answers, so `<all_urls>` would put every page load
 * behind this one.
 */
const matchPatterns = (origins: Iterable<string>): string[] => {
  const patterns = new Set<string>()
  for (const origin of origins) {
    try {
      const url = new URL(origin)
      patterns.add(`${url.protocol}//${url.hostname}/*`)
    } catch {
      continue
    }
  }
  return [...patterns]
}

const unregister = (): void => {
  if (!registered) return
  browser.webRequest.onBeforeSendHeaders.removeListener(registered)
  registered = undefined
}

const register = (): void => {
  unregister()
  const urls = matchPatterns(strippedOrigins)
  if (urls.length === 0) return
  const listener = (details: HeaderDetails) => stripProviderOrigin(details)
  browser.webRequest.onBeforeSendHeaders.addListener(
    listener,
    { urls, types: ["xmlhttprequest"] },
    ["blocking", "requestHeaders"]
  )
  registered = listener
}

const applyStrippedOrigins = (): void => {
  strippedOrigins = new Set([...configuredOrigins, ...draftOrigins.keys()])
  try {
    register()
  } catch (error) {
    clearStrippedProviderOrigins()
    throw error
  }
}

/**
 * Replace the stripped set with exactly these base URLs' origins, plus any
 * draft origin a connection test still holds. If the listener cannot be
 * registered the set is emptied, so a failure strips nothing rather than
 * leaving a stale set in force.
 */
export const setStrippedProviderOrigins = (
  baseUrls: readonly string[]
): void => {
  configuredOrigins = providerOrigins(baseUrls)
  applyStrippedOrigins()
}

/**
 * Add one origin without disturbing the rest, for a draft connection test
 * whose base URL is not saved yet. The returned release drops it again once
 * no test holds it; a configured provider's origin stays.
 */
export const addStrippedProviderOrigin = (baseUrl: string): (() => void) => {
  const [origin] = providerOrigins([baseUrl])
  if (!origin) return () => undefined
  draftOrigins.set(origin, (draftOrigins.get(origin) ?? 0) + 1)
  if (!strippedOrigins.has(origin)) applyStrippedOrigins()
  let released = false
  return () => {
    if (released) return
    released = true
    const holders = draftOrigins.get(origin)
    if (holders === undefined) return
    if (holders > 1) {
      draftOrigins.set(origin, holders - 1)
      return
    }
    draftOrigins.delete(origin)
    if (configuredOrigins.includes(origin)) return
    applyStrippedOrigins()
  }
}

/** Strip nothing: the browser's default behaviour. Drafts included. */
export const clearStrippedProviderOrigins = (): void => {
  strippedOrigins = new Set()
  configuredOrigins = []
  draftOrigins.clear()
  try {
    unregister()
  } catch {
    registered = undefined
  }
}

/** The origins currently stripped, for diagnostics and tests. */
export const strippedProviderOrigins = (): string[] => [...strippedOrigins]
