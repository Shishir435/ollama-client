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

export const openOptionsInTab = async (): Promise<void> => {
  const optionsUrl = runtime.getURL("options.html")

  try {
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
