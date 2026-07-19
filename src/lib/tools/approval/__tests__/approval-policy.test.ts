import { describe, expect, it } from "vitest"

import {
  allowedScopesForRisk,
  approvalGrantKey,
  confirmationRequired,
  defaultScopeForRisk,
  effectiveRisk,
  normalizeGrantOrigin
} from "../approval-policy"

const noGrants = { hasSessionGrant: false, hasAlwaysGrant: false }

describe("normalizeGrantOrigin", () => {
  it("reduces an http(s) URL to its origin", () => {
    expect(normalizeGrantOrigin("https://github.com/a/b?c=d#e")).toBe(
      "https://github.com"
    )
    expect(normalizeGrantOrigin("http://localhost:8080/page")).toBe(
      "http://localhost:8080"
    )
  })

  it("returns undefined for non-web and unparseable URLs", () => {
    expect(normalizeGrantOrigin("chrome://settings")).toBeUndefined()
    expect(normalizeGrantOrigin("about:blank")).toBeUndefined()
    expect(normalizeGrantOrigin("file:///etc/passwd")).toBeUndefined()
    expect(normalizeGrantOrigin("javascript:alert(1)")).toBeUndefined()
    expect(normalizeGrantOrigin("not a url")).toBeUndefined()
    expect(normalizeGrantOrigin("")).toBeUndefined()
    expect(normalizeGrantOrigin(undefined)).toBeUndefined()
  })
})

describe("effectiveRisk", () => {
  it("defaults an undeclared tool to low", () => {
    expect(effectiveRisk(undefined)).toBe("low")
    expect(effectiveRisk({})).toBe("low")
  })

  it("forces at least high for legacy requiresConfirmation tools", () => {
    expect(effectiveRisk({ requiresConfirmation: true })).toBe("high")
    expect(effectiveRisk({ risk: "medium", requiresConfirmation: true })).toBe(
      "high"
    )
    expect(effectiveRisk({ risk: "high", requiresConfirmation: true })).toBe(
      "high"
    )
    expect(
      effectiveRisk({ risk: "critical", requiresConfirmation: true })
    ).toBe("critical")
  })
})

describe("confirmationRequired", () => {
  it("never prompts for low risk", () => {
    expect(confirmationRequired({ risk: "low" }, noGrants)).toBe(false)
  })

  it("prompts for medium/high without grants", () => {
    expect(confirmationRequired({ risk: "medium" }, noGrants)).toBe(true)
    expect(confirmationRequired({ risk: "high" }, noGrants)).toBe(true)
  })

  it("honors session and always grants for medium/high", () => {
    for (const risk of ["medium", "high"] as const) {
      expect(
        confirmationRequired(
          { risk },
          { hasSessionGrant: true, hasAlwaysGrant: false }
        )
      ).toBe(false)
      expect(
        confirmationRequired(
          { risk },
          { hasSessionGrant: false, hasAlwaysGrant: true }
        )
      ).toBe(false)
    }
  })

  it("always prompts for critical, ignoring every grant", () => {
    expect(
      confirmationRequired(
        { risk: "critical" },
        { hasSessionGrant: true, hasAlwaysGrant: true }
      )
    ).toBe(true)
  })
})

describe("scopes", () => {
  it("offers no broad grants for critical", () => {
    expect(allowedScopesForRisk("critical")).toEqual(["once"])
  })

  it("caps medium at a per-chat grant; only high offers always", () => {
    expect(allowedScopesForRisk("medium")).toEqual(["once", "session"])
    expect(allowedScopesForRisk("high")).toEqual(["once", "session", "always"])
  })

  it("defaults medium to a chat-wide grant, high/critical to one call", () => {
    expect(defaultScopeForRisk("medium")).toBe("session")
    expect(defaultScopeForRisk("high")).toBe("once")
    expect(defaultScopeForRisk("critical")).toBe("once")
  })
})

describe("approvalGrantKey", () => {
  it("scopes by tool and origin with a wildcard fallback", () => {
    expect(approvalGrantKey("click", "https://github.com")).toBe(
      "click::https://github.com"
    )
    expect(approvalGrantKey("cancel_reminder")).toBe("cancel_reminder::*")
  })
})
