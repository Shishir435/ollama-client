import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  applyProviderOriginRules,
  buildProviderOriginRule,
  buildProviderOriginRules,
  clearProviderOriginRules,
  ensureProviderOriginRule,
  providerOriginRulesCover,
  providerOrigins,
  readProviderOriginRules
} from "../dnr-rules"

const updateDynamicRules = vi.fn()
const getDynamicRules = vi.fn()

beforeEach(async () => {
  vi.clearAllMocks()
  updateDynamicRules.mockResolvedValue(undefined)
  getDynamicRules.mockResolvedValue([])
  Object.assign(chrome, {
    declarativeNetRequest: {
      updateDynamicRules,
      getDynamicRules,
      RuleActionType: { MODIFY_HEADERS: "modifyHeaders" },
      HeaderOperation: { SET: "set", REMOVE: "remove" },
      ResourceType: { XMLHTTPREQUEST: "xmlhttprequest" }
    }
  })
  /** Forget the previous test's reconciled set and held drafts. */
  await clearProviderOriginRules()
  vi.clearAllMocks()
  updateDynamicRules.mockResolvedValue(undefined)
  getDynamicRules.mockResolvedValue([])
})

/** A DNR double that keeps what was written, so read-backs see it. */
const installRuleStore = () => {
  let installed: chrome.declarativeNetRequest.Rule[] = []
  getDynamicRules.mockImplementation(async () => installed)
  updateDynamicRules.mockImplementation(
    async ({
      removeRuleIds = [],
      addRules = []
    }: chrome.declarativeNetRequest.UpdateRuleOptions) => {
      installed = [
        ...installed.filter((rule) => !removeRuleIds.includes(rule.id)),
        ...addRules
      ]
    }
  )
  return () => installed.map((rule) => rule.condition.urlFilter)
}

/** The shape an older version installed: no initiator condition at all. */
const unrestrictedLegacyRule = {
  id: 1,
  priority: 1,
  action: {
    type: "modifyHeaders",
    requestHeaders: [
      { header: "Origin", operation: "set", value: "http://localhost:11434" }
    ]
  },
  condition: {
    urlFilter: "http://localhost:11434/*",
    resourceTypes: ["xmlhttprequest"]
  }
}

describe("provider origin rules", () => {
  it("removes Origin only on the extension's own requests to that origin", () => {
    expect(buildProviderOriginRule("http://localhost:11434", 3)).toEqual({
      id: 3,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "Origin", operation: "remove" }]
      },
      condition: {
        urlFilter: "|http://localhost:11434/",
        initiatorDomains: ["test-extension-id"],
        resourceTypes: ["xmlhttprequest"]
      }
    })
  })

  it("pins every rule to the extension as initiator", () => {
    const rules = buildProviderOriginRules([
      "http://localhost:11434",
      "https://llm.example.com",
      "http://localhost:1234"
    ])

    expect(rules.map((rule) => rule.id)).toEqual([1, 2, 3])
    for (const rule of rules) {
      expect(rule.condition.initiatorDomains).toEqual(["test-extension-id"])
      expect(rule.condition.urlFilter?.startsWith("|")).toBe(true)
    }
  })

  it("matches the whole origin, so listing and chat share one rule", () => {
    const [rule] = buildProviderOriginRules(["https://llm.example.com"])
    /*
     * A path-anchored filter is how listing went uncovered before: the filter
     * names the origin and nothing below it, so `/v1/models`, `/api/tags`,
     * `/api/show`, `/api/embed`, `/api/pull` and `/v1/chat/completions` all
     * fall under it.
     */
    expect(rule.condition.urlFilter).toBe("|https://llm.example.com/")
  })

  it("derives one origin per endpoint and drops what cannot carry a rule", () => {
    expect(
      providerOrigins([
        "http://localhost:11434",
        "http://localhost:11434/v1",
        "https://llm.example.com/v1",
        "http://localhost:1234/v1",
        "not a url",
        "file:///tmp/x"
      ])
    ).toEqual([
      "http://localhost:11434",
      "http://localhost:1234",
      "https://llm.example.com"
    ])
  })

  it("replaces every existing rule, including an unrestricted legacy one", async () => {
    getDynamicRules.mockResolvedValue([
      unrestrictedLegacyRule,
      { ...unrestrictedLegacyRule, id: 9 }
    ])

    await applyProviderOriginRules(["http://localhost:11434"])

    expect(updateDynamicRules).toHaveBeenCalledWith({
      removeRuleIds: [1, 9],
      addRules: buildProviderOriginRules(["http://localhost:11434"])
    })
  })

  it("clears every rule, the unrestricted legacy one included", async () => {
    getDynamicRules.mockResolvedValue([unrestrictedLegacyRule, { id: 7 }])

    await clearProviderOriginRules()

    expect(updateDynamicRules).toHaveBeenCalledWith({ removeRuleIds: [1, 7] })
  })

  it("writes nothing when there is no rule to clear", async () => {
    await clearProviderOriginRules()

    expect(updateDynamicRules).not.toHaveBeenCalled()
  })

  it("reads back only whether each rule fires and for whom", async () => {
    getDynamicRules.mockResolvedValue([
      { id: 7, action: {}, condition: { urlFilter: "http://other/*" } },
      buildProviderOriginRule("http://localhost:11434", 1),
      unrestrictedLegacyRule
    ])

    await expect(readProviderOriginRules()).resolves.toEqual([
      {
        urlFilter: "|http://localhost:11434/",
        removesOrigin: true,
        extensionOnly: true
      },
      {
        urlFilter: "http://localhost:11434/*",
        removesOrigin: false,
        extensionOnly: false
      }
    ])
  })

  it("does not count a stale or unrestricted rule as coverage", () => {
    const current = {
      urlFilter: "|http://localhost:11434/",
      removesOrigin: true,
      extensionOnly: true
    }

    expect(providerOriginRulesCover([current], "http://localhost:11434")).toBe(
      true
    )
    expect(providerOriginRulesCover([current], "http://127.0.0.1:11434")).toBe(
      false
    )
    expect(
      providerOriginRulesCover(
        [{ ...current, extensionOnly: false }],
        "http://localhost:11434"
      )
    ).toBe(false)
    expect(providerOriginRulesCover([], "http://localhost:11434")).toBe(false)
  })

  it("adds a draft's origin without disturbing the reconciled set", async () => {
    getDynamicRules.mockResolvedValue(
      buildProviderOriginRules(["http://localhost:11434"])
    )

    await ensureProviderOriginRule("https://llm.example.com/v1")

    expect(updateDynamicRules).toHaveBeenCalledWith({
      addRules: [buildProviderOriginRule("https://llm.example.com", 2)]
    })
  })

  it("leaves an already-covered draft origin alone", async () => {
    getDynamicRules.mockResolvedValue(
      buildProviderOriginRules(["http://localhost:11434"])
    )

    await ensureProviderOriginRule("http://localhost:11434")

    expect(updateDynamicRules).not.toHaveBeenCalled()
  })

  it("runs overlapping writes one after another", async () => {
    let installed: chrome.declarativeNetRequest.Rule[] = []
    getDynamicRules.mockImplementation(async () => installed)
    updateDynamicRules.mockImplementation(
      async ({
        removeRuleIds = [],
        addRules = []
      }: chrome.declarativeNetRequest.UpdateRuleOptions) => {
        const ids = new Set(installed.map((rule) => rule.id))
        for (const rule of addRules) {
          if (ids.has(rule.id) && !removeRuleIds.includes(rule.id)) {
            throw new Error(`duplicate rule id ${rule.id}`)
          }
        }
        installed = [
          ...installed.filter((rule) => !removeRuleIds.includes(rule.id)),
          ...addRules
        ]
      }
    )

    await Promise.all([
      ensureProviderOriginRule("https://a.example"),
      ensureProviderOriginRule("https://b.example")
    ])

    expect(installed.map((rule) => rule.id)).toEqual([1, 2])
  })

  it("removes a draft's rule once the test that added it settles", async () => {
    const filters = installRuleStore()
    await applyProviderOriginRules(["http://localhost:11434"])

    const release = await ensureProviderOriginRule("https://draft.example/v1")
    expect(filters()).toContain("|https://draft.example/")

    await release()

    expect(filters()).toEqual(["|http://localhost:11434/"])
  })

  it("keeps the rule when the draft origin is a configured provider", async () => {
    const filters = installRuleStore()
    await applyProviderOriginRules(["http://localhost:11434"])

    const release = await ensureProviderOriginRule("http://localhost:11434")
    await release()

    expect(filters()).toEqual(["|http://localhost:11434/"])
  })

  it("keeps a draft's rule until the last test holding it settles", async () => {
    const filters = installRuleStore()
    await applyProviderOriginRules([])

    const first = await ensureProviderOriginRule("https://draft.example")
    const second = await ensureProviderOriginRule("https://draft.example")
    await first()
    expect(filters()).toEqual(["|https://draft.example/"])

    await second()
    expect(filters()).toEqual([])
  })

  it("keeps a held draft origin through a reconcile", async () => {
    const filters = installRuleStore()
    const release = await ensureProviderOriginRule("https://draft.example")

    await applyProviderOriginRules(["http://localhost:11434"])
    expect(filters()).toEqual([
      "|http://localhost:11434/",
      "|https://draft.example/"
    ])

    await release()
    expect(filters()).toEqual(["|http://localhost:11434/"])
  })
})
