/**
 * Origin-guard capability checks without the WebExtension polyfill.
 *
 * Provider modules import this, and Node-side tooling (the docs generator)
 * imports those providers; `webextension-polyfill` throws when loaded outside
 * an extension, so these read the native `chrome` / `browser` globals instead.
 */

type HeaderListenerHost = {
  webRequest?: { onBeforeSendHeaders?: { addListener?: unknown } }
}

/** Chromium's declarativeNetRequest dynamic rules. */
export const supportsDNR = (): boolean =>
  typeof chrome !== "undefined" &&
  typeof chrome.declarativeNetRequest?.updateDynamicRules === "function"

/**
 * A blocking `webRequest.onBeforeSendHeaders` listener — Firefox, where the
 * manifest grants `webRequest` + `webRequestBlocking` in place of DNR.
 */
export const supportsWebRequestHeaders = (): boolean => {
  const host = (globalThis as { browser?: HeaderListenerHost }).browser
  return (
    typeof host?.webRequest?.onBeforeSendHeaders?.addListener === "function"
  )
}

/**
 * Whether this browser removes `Origin` from the extension's own requests to
 * configured providers — DNR rules on Chromium, the header listener on
 * Firefox. Where it does, a 401/403 from a provider is the server or a proxy
 * refusing the request, not an origin check; only where it does not is
 * `OLLAMA_ORIGINS` the fix.
 */
export const supportsProviderOriginGuard = (): boolean =>
  supportsDNR() || supportsWebRequestHeaders()
