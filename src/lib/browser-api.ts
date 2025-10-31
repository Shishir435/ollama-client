import browser from "webextension-polyfill"

export { browser }
export default browser

export const isChromiumBased = (): boolean => {
  if (typeof chrome === "undefined") {
    return false
  }

  if (typeof chrome.declarativeNetRequest === "undefined") {
    return false
  }

  // Firefox polyfill might create chrome.declarativeNetRequest as an empty object
  // So we need to check if the actual API properties we use exist
  try {
    return (
      typeof chrome.declarativeNetRequest.RuleActionType !== "undefined" &&
      typeof chrome.declarativeNetRequest.HeaderOperation !== "undefined" &&
      typeof chrome.declarativeNetRequest.ResourceType !== "undefined" &&
      typeof chrome.declarativeNetRequest.updateDynamicRules === "function"
    )
  } catch {
    return false
  }
}

export const isFirefox = (): boolean => {
  return !isChromiumBased()
}

// Type-safe browser runtime API
export const runtime = browser.runtime
export const action = browser.action
