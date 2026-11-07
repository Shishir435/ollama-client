/**
 * Chromium attaches `Origin: chrome-extension://<id>` to the extension's
 * non-GET requests but not to its GETs. Ollama's CORS check rejects an origin
 * it does not recognise with 403 and lets a request with no origin through, so
 * listing worked while chat failed against any Ollama that was not told about
 * the extension (#464). The extension already bypasses CORS through its host
 * permissions; the header buys nothing and only decides whether a server
 * refuses us. So these rules remove it, once per configured provider origin,
 * from every request the extension sends there — list, show, chat, embed,
 * pull — and the request reaches the server exactly as a `curl` would.
 *
 * Every rule is pinned to the extension as initiator. A dynamic rule without
 * an initiator condition applies to every tab's traffic too, which is what the
 * previous rule did: it rewrote `Origin` to the provider's own origin for any
 * page the user visited, so any website could drive the user's local Ollama
 * past its origin check.
 *
 * The rule shape, the reconcile and the read-back all live here on purpose. A
 * diagnostics self-test asserts coverage; a self-test holding its own copy of
 * the shape is a self-test that can report "installed" about a rule nobody
 * writes.
 */
export const PROVIDER_ORIGIN_RULE_ID_BASE = 1

/** The header the rules act on. */
const ORIGIN_HEADER = "Origin"

/**
 * `urlFilter` without an anchor is a substring match, so `http://host/*`
 * would also match a URL carrying that text in its query. `|` anchors the
 * filter to the start of the URL and the trailing `/` stops a prefix host
 * (`localhost:1143` vs `localhost:11434`) from matching.
 */
export const providerOriginUrlFilter = (origin: string): string => `|${origin}/`

/** The id DNR reports as the initiator domain of the extension's requests. */
const extensionInitiatorDomain = (): string => chrome.runtime.id

/**
 * `http(s)` origins of the given base URLs, deduplicated and sorted so the
 * reconciled rule set is stable across boots. Anything that does not parse,
 * or is not http(s), is skipped: no rule is better than a malformed one that
 * fails the whole update.
 */
export const providerOrigins = (baseUrls: readonly string[]): string[] => {
  const origins = new Set<string>()
  for (const baseUrl of baseUrls) {
    try {
      const url = new URL(baseUrl)
      if (url.protocol === "http:" || url.protocol === "https:") {
        origins.add(url.origin)
      }
    } catch {
      continue
    }
  }
  return [...origins].sort()
}

export const buildProviderOriginRule = (
  origin: string,
  id: number
): chrome.declarativeNetRequest.Rule => ({
  id,
  priority: 1,
  action: {
    type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
    requestHeaders: [
      {
        header: ORIGIN_HEADER,
        operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE
      }
    ]
  },
  condition: {
    urlFilter: providerOriginUrlFilter(origin),
    initiatorDomains: [extensionInitiatorDomain()],
    resourceTypes: [chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST]
  }
})

export const buildProviderOriginRules = (
  origins: readonly string[]
): chrome.declarativeNetRequest.Rule[] =>
  origins.map((origin, index) =>
    buildProviderOriginRule(origin, PROVIDER_ORIGIN_RULE_ID_BASE + index)
  )

/**
 * Background callers (startup, provider-config change, a draft connection
 * test) can overlap, and each reads the rule set before writing it. Two
 * overlapping writers would pick the same free id and the second update would
 * be rejected, so every write goes through one queue.
 */
let ruleWrites: Promise<unknown> = Promise.resolve()
const serialized = <T>(work: () => Promise<T>): Promise<T> => {
  const next = ruleWrites.then(work, work)
  ruleWrites = next.catch(() => undefined)
  return next
}

/**
 * What the last successful reconcile installed, and the draft origins a
 * connection test is holding. `undefined` until this worker has reconciled:
 * dynamic rules outlive the worker, so before then nothing here knows which
 * installed rule belongs to a configured provider.
 */
let configuredOrigins: readonly string[] | undefined
const draftOrigins = new Map<string, number>()

const withDraftOrigins = (origins: readonly string[]): string[] =>
  [...new Set([...origins, ...draftOrigins.keys()])].sort()

/**
 * Replace the whole dynamic rule set with one rule per origin, plus any draft
 * origin a connection test still holds. The extension owns every dynamic rule
 * it has, so removing all of them also removes a rule left by an older
 * version — including the unrestricted one. Callers must have checked
 * `supportsDNR()`.
 */
export const applyProviderOriginRules = (
  origins: readonly string[]
): Promise<void> =>
  serialized(async () => {
    const existing = await chrome.declarativeNetRequest.getDynamicRules()
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((rule) => rule.id),
      addRules: buildProviderOriginRules(withDraftOrigins(origins))
    })
    configuredOrigins = [...origins]
  })

/**
 * Remove every dynamic rule. For a reconcile that could not work out which
 * origins to cover: no rule costs a 403 from a server that checks `Origin`,
 * while a rule left by an older version may still rewrite `Origin` for every
 * page the user visits. Failing closed picks the first, for drafts too.
 */
export const clearProviderOriginRules = (): Promise<void> =>
  serialized(async () => {
    configuredOrigins = undefined
    draftOrigins.clear()
    const existing = await chrome.declarativeNetRequest.getDynamicRules()
    if (existing.length === 0) return
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((rule) => rule.id)
    })
  })

export type ProviderOriginRuleState = {
  urlFilter: string
  removesOrigin: boolean
  extensionOnly: boolean
}

const describeRule = (
  rule: chrome.declarativeNetRequest.Rule
): ProviderOriginRuleState | undefined => {
  const header = rule.action?.requestHeaders?.find(
    (entry) => entry.header.toLowerCase() === ORIGIN_HEADER.toLowerCase()
  )
  if (!header) return undefined
  const initiators = rule.condition?.initiatorDomains ?? []
  return {
    urlFilter: rule.condition?.urlFilter ?? "",
    removesOrigin:
      header.operation === chrome.declarativeNetRequest.HeaderOperation.REMOVE,
    extensionOnly:
      initiators.length === 1 && initiators[0] === extensionInitiatorDomain()
  }
}

/**
 * Read the installed Origin rules back. Returns only the fields that decide
 * whether a rule fires and for whom — never the raw rule, because the caller
 * is the diagnostics path and diagnostics never carry the user's endpoint.
 */
export const readProviderOriginRules = async (): Promise<
  ProviderOriginRuleState[]
> => {
  const rules = await chrome.declarativeNetRequest.getDynamicRules()
  return rules.flatMap((rule) => describeRule(rule) ?? [])
}

/**
 * Does the installed set cover requests to this origin, removing the header
 * and only for the extension's own requests? A rule for a base URL the user
 * has since changed, or an unrestricted rule from an older version, does not.
 */
export const providerOriginRulesCover = (
  states: readonly ProviderOriginRuleState[],
  origin: string
): boolean =>
  states.some(
    (state) =>
      state.urlFilter === providerOriginUrlFilter(origin) &&
      state.removesOrigin &&
      state.extensionOnly
  )

/**
 * Add a rule for one origin if the set does not already cover it, keeping
 * every other rule. For a draft connection test, whose base URL is not saved
 * yet and so is not in the reconciled set. The returned release removes the
 * rule again once no test holds it, unless the origin belongs to a configured
 * provider — so a test does not leave a rule behind for an origin the user
 * never saved.
 */
export const ensureProviderOriginRule = async (
  baseUrl: string
): Promise<() => Promise<void>> => {
  const [origin] = providerOrigins([baseUrl])
  if (!origin) return async () => undefined
  await serialized(async () => {
    const existing = await chrome.declarativeNetRequest.getDynamicRules()
    const states = existing.flatMap((rule) => describeRule(rule) ?? [])
    if (!providerOriginRulesCover(states, origin)) {
      const nextId =
        Math.max(
          PROVIDER_ORIGIN_RULE_ID_BASE - 1,
          ...existing.map((rule) => rule.id)
        ) + 1
      await chrome.declarativeNetRequest.updateDynamicRules({
        addRules: [buildProviderOriginRule(origin, nextId)]
      })
    }
    /** Counted only once held, so a refused write leaves no phantom draft. */
    draftOrigins.set(origin, (draftOrigins.get(origin) ?? 0) + 1)
  })
  let released = false
  return () => {
    if (released) return Promise.resolve()
    released = true
    return releaseDraftOrigin(origin)
  }
}

const releaseDraftOrigin = (origin: string): Promise<void> =>
  serialized(async () => {
    const holders = draftOrigins.get(origin)
    /** A fail-closed clear already dropped every draft and its rule. */
    if (holders === undefined) return
    if (holders > 1) {
      draftOrigins.set(origin, holders - 1)
      return
    }
    draftOrigins.delete(origin)
    if (!configuredOrigins || configuredOrigins.includes(origin)) return
    const urlFilter = providerOriginUrlFilter(origin)
    const existing = await chrome.declarativeNetRequest.getDynamicRules()
    const removeRuleIds = existing
      .filter((rule) => rule.condition?.urlFilter === urlFilter)
      .map((rule) => rule.id)
    if (removeRuleIds.length === 0) return
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds })
  })
