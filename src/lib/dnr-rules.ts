import type { DNRRule } from "@/types"

/**
 * Chromium rewrites the `Origin` header on requests to the local provider so a
 * server that only answers same-origin XHR (Ollama's default posture) accepts
 * the extension. Exactly one dynamic rule does that.
 *
 * The id, the rule shape, and the read-back all live here on purpose. Two call
 * sites install this rule (startup and base-URL change) and a diagnostics
 * self-test asserts it is present; a self-test holding its own copy of the id
 * is a self-test that can report "installed" about a rule nobody writes.
 */
export const LOCAL_PROVIDER_ORIGIN_RULE_ID = 1

export const buildLocalProviderOriginRule = (origin: string): DNRRule => ({
  id: LOCAL_PROVIDER_ORIGIN_RULE_ID,
  priority: 1,
  action: {
    type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
    requestHeaders: [
      {
        header: "Origin",
        operation: chrome.declarativeNetRequest.HeaderOperation.SET,
        value: origin
      }
    ]
  },
  condition: {
    urlFilter: `${origin}/*`,
    resourceTypes: [chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST]
  }
})

/** Replace the rule in place. Callers must have checked `supportsDNR()`. */
export const applyLocalProviderOriginRule = async (
  origin: string
): Promise<void> => {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [LOCAL_PROVIDER_ORIGIN_RULE_ID],
    addRules: [buildLocalProviderOriginRule(origin)]
  })
}

export type LocalProviderOriginRuleState =
  | { installed: false }
  | { installed: true; urlFilter: string; headerValue: string }

/**
 * Read the installed rule back. Returns the two fields that decide whether the
 * rewrite will actually fire — never the whole rule, because the caller is the
 * diagnostics path and the raw rule carries the user's endpoint.
 */
export const readLocalProviderOriginRule =
  async (): Promise<LocalProviderOriginRuleState> => {
    const rules = await chrome.declarativeNetRequest.getDynamicRules()
    const rule = rules.find(
      (candidate) => candidate.id === LOCAL_PROVIDER_ORIGIN_RULE_ID
    )
    if (!rule) return { installed: false }
    const header = rule.action?.requestHeaders?.find(
      (entry) => entry.header.toLowerCase() === "origin"
    )
    return {
      installed: true,
      urlFilter: rule.condition?.urlFilter ?? "",
      headerValue: header?.value ?? ""
    }
  }

/**
 * Does the installed rule still describe the endpoint the extension will call?
 * A stale rule is the interesting failure: the API is present, the rule exists,
 * and requests still get rejected because the base URL moved after install.
 */
export const localProviderOriginRuleMatches = (
  state: LocalProviderOriginRuleState,
  origin: string
): boolean =>
  state.installed &&
  state.urlFilter === `${origin}/*` &&
  state.headerValue === origin
