import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  applyLocalProviderOriginRule,
  buildLocalProviderOriginRule,
  LOCAL_PROVIDER_ORIGIN_RULE_ID,
  localProviderOriginRuleMatches,
  readLocalProviderOriginRule
} from "../dnr-rules"

const updateDynamicRules = vi.fn()
const getDynamicRules = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  updateDynamicRules.mockResolvedValue(undefined)
  getDynamicRules.mockResolvedValue([])
  Object.assign(chrome, {
    declarativeNetRequest: {
      updateDynamicRules,
      getDynamicRules,
      RuleActionType: { MODIFY_HEADERS: "modifyHeaders" },
      HeaderOperation: { SET: "set" },
      ResourceType: { XMLHTTPREQUEST: "xmlhttprequest" }
    }
  })
})

describe("local provider origin rule", () => {
  it("rewrites Origin for the provider's own origin only", () => {
    const rule = buildLocalProviderOriginRule("http://localhost:11434")

    expect(rule).toMatchObject({
      id: LOCAL_PROVIDER_ORIGIN_RULE_ID,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          {
            header: "Origin",
            operation: "set",
            value: "http://localhost:11434"
          }
        ]
      },
      condition: {
        urlFilter: "http://localhost:11434/*",
        resourceTypes: ["xmlhttprequest"]
      }
    })
  })

  it("replaces rather than accumulates, so a changed base URL leaves one rule", async () => {
    await applyLocalProviderOriginRule("http://localhost:11434")

    expect(updateDynamicRules).toHaveBeenCalledWith({
      removeRuleIds: [LOCAL_PROVIDER_ORIGIN_RULE_ID],
      addRules: [buildLocalProviderOriginRule("http://localhost:11434")]
    })
  })

  it("reads back only the two fields that decide whether the rewrite fires", async () => {
    getDynamicRules.mockResolvedValue([
      { id: 7, condition: { urlFilter: "http://other/*" } },
      buildLocalProviderOriginRule("http://localhost:11434")
    ])

    await expect(readLocalProviderOriginRule()).resolves.toEqual({
      installed: true,
      urlFilter: "http://localhost:11434/*",
      headerValue: "http://localhost:11434"
    })
  })

  it("reports an absent rule instead of throwing", async () => {
    getDynamicRules.mockResolvedValue([{ id: 7, condition: {} }])

    await expect(readLocalProviderOriginRule()).resolves.toEqual({
      installed: false
    })
  })

  it("treats a rule written for a previous base URL as a mismatch", () => {
    const installed = {
      installed: true as const,
      urlFilter: "http://localhost:11434/*",
      headerValue: "http://localhost:11434"
    }

    expect(
      localProviderOriginRuleMatches(installed, "http://localhost:11434")
    ).toBe(true)
    expect(
      localProviderOriginRuleMatches(installed, "http://127.0.0.1:11434")
    ).toBe(false)
    expect(
      localProviderOriginRuleMatches({ installed: false }, "http://localhost")
    ).toBe(false)
  })
})
