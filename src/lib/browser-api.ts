import browser from "webextension-polyfill"

export { browser }
export default browser

export const isChromiumBased = (): boolean => {
  if (typeof chrome === "undefined") {
    return false
  }

  const ua = globalThis.navigator?.userAgent ?? ""
  if (/firefox/i.test(ua)) {
    return false
  }

  try {
    // Prefer concrete runtime API checks over enum presence to avoid false negatives
    // across Chromium versions and polyfill differences.
    if (
      typeof chrome.declarativeNetRequest?.updateDynamicRules === "function"
    ) {
      return true
    }

    return typeof chrome.sidePanel !== "undefined"
  } catch {
    return false
  }
}

export const isFirefox = (): boolean => {
  return !isChromiumBased()
}

/**
 * Capability gates (v0.11.0 groundwork — FEATURE_ROADMAP §5).
 *
 * Feature-detect browser support so each feature can degrade predictably instead
 * of throwing on a browser that lacks the API. These answer "can this browser do
 * X at all" — NOT "has the user granted permission for X" (that is `permissions.ts`).
 */

const hasChromeNamespace = (name: string): boolean =>
  typeof chrome !== "undefined" &&
  typeof (chrome as unknown as Record<string, unknown>)[name] !== "undefined"

/** Native side panel (Chromium). Firefox falls back to a popup window. */
export const supportsSidePanel = (): boolean => hasChromeNamespace("sidePanel")

/** declarativeNetRequest dynamic rules — used for localhost-provider CORS (Chromium). */
export const supportsDNR = (): boolean =>
  typeof chrome !== "undefined" &&
  typeof chrome.declarativeNetRequest?.updateDynamicRules === "function"

const hasBrowserNamespace = (name: string): boolean =>
  typeof (browser as unknown as Record<string, unknown>)[name] !== "undefined"

const getFirefoxMajorVersion = (): number | undefined => {
  const match = globalThis.navigator?.userAgent?.match(/Firefox\/(\d+)/i)
  if (!match?.[1]) return undefined
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Tab groups — Chromium and Firefox 139+. */
export const supportsTabGroups = (): boolean =>
  hasBrowserNamespace("tabGroups") ||
  hasChromeNamespace("tabGroups") ||
  (getFirefoxMajorVersion() ?? 0) >= 139

/** Browser-level keyboard commands (Chrome + Firefox). */
export const supportsCommands = (): boolean =>
  typeof browser.commands?.getAll === "function"

/** Visible-tab screenshot (Chrome + Firefox). */
export const supportsCaptureVisibleTab = (): boolean =>
  typeof browser.tabs?.captureVisibleTab === "function"

/** Address-bar keyword entry (Chrome + Firefox). */
export const supportsOmnibox = (): boolean => hasChromeNamespace("omnibox")

/** Bookmark tree access. Requires optional `bookmarks` permission before use. */
export const supportsBookmarks = (): boolean =>
  typeof browser.bookmarks?.getTree === "function"

/** Browser history search. Requires optional `history` permission before use. */
export const supportsHistory = (): boolean =>
  typeof browser.history?.search === "function"

/** Durable background alarms for scheduled local jobs (Chrome + Firefox). */
export const supportsAlarms = (): boolean =>
  typeof browser.alarms?.create === "function" &&
  typeof browser.alarms?.clear === "function"

/**
 * Offscreen documents are PARKED — the extension CSP blocked the approach for
 * embedding/HNSW work (FEATURE_ROADMAP §7). Always false until that is revisited;
 * callers must not route work through offscreen.
 */
export const supportsOffscreen = (): boolean => false

export const openOptionsInTab = async (
  targetOptionsUrl?: string
): Promise<void> => {
  const optionsBaseUrl = runtime.getURL("options.html")
  const optionsUrl = targetOptionsUrl || optionsBaseUrl

  try {
    if (browser.tabs?.query) {
      const tabs = await browser.tabs.query({ url: `${optionsBaseUrl}*` })
      if (tabs.length > 0) {
        const tab = tabs[0]
        if (tab.id && tab.windowId) {
          await browser.tabs.update(tab.id, { active: true, url: optionsUrl })
          await browser.windows.update(tab.windowId, { focused: true })
          return
        }
      }
    }

    if (browser.tabs?.create) {
      await browser.tabs.create({ url: optionsUrl })
      return
    }
  } catch {
    // Fallback to runtime API below.
  }

  await runtime.openOptionsPage()
}

// Type-safe browser runtime API
export const runtime = browser.runtime
export const action = browser.action

/**
 * Opens an external URL in a new browser tab.
 * Regular <a target="_blank"> links don't work in extension sidepanels/popups;
 * tabs.create is the correct cross-browser approach.
 */
export const openExternalUrl = (url: string): void => {
  browser.tabs.create({ url }).catch(() => {
    // Fallback: let the browser handle it natively
    globalThis.open(url, "_blank", "noopener,noreferrer")
  })
}
