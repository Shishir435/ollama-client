import { describe, expect, it } from "vitest"

import { compileSafePattern, matchesUserPattern } from "@/lib/url-pattern"

describe("compileSafePattern", () => {
  it("compiles ordinary URL patterns", () => {
    expect(compileSafePattern("^https://login\\.")).toBeInstanceOf(RegExp)
    expect(compileSafePattern("foo\\.bar")).toBeInstanceOf(RegExp)
    expect(compileSafePattern("github\\.com/.*/issues")).toBeInstanceOf(RegExp)
  })

  it("returns null for invalid regex", () => {
    expect(compileSafePattern("admin[")).toBeNull()
  })

  it("returns null for empty or oversized patterns", () => {
    expect(compileSafePattern("")).toBeNull()
    expect(compileSafePattern("a".repeat(513))).toBeNull()
  })

  it("rejects classic ReDoS shapes", () => {
    expect(compileSafePattern("(a+)+$")).toBeNull()
    expect(compileSafePattern("([a-z]*)*")).toBeNull()
    expect(compileSafePattern("(a|aa)+b")).toBeNull()
    expect(compileSafePattern(".*.*=.*")).toBeInstanceOf(RegExp) // linear, allowed
  })

  it("does not hang on adversarial pattern + input", () => {
    const start = Date.now()
    matchesUserPattern(`https://example.com/${"a".repeat(5000)}!`, "(a+)+$")
    expect(Date.now() - start).toBeLessThan(200)
  })
})

describe("matchesUserPattern", () => {
  it("matches via regex when pattern is valid", () => {
    expect(
      matchesUserPattern("https://login.example.com/", "^https://login\\.")
    ).toBe(true)
  })

  it("falls back to substring on invalid regex", () => {
    expect(matchesUserPattern("https://x.com/admin[panel", "admin[")).toBe(true)
    expect(matchesUserPattern("https://x.com/admin", "admin[")).toBe(false)
  })

  it("falls back to substring on unsafe regex", () => {
    expect(matchesUserPattern("literal (a+)+ text", "(a+)+")).toBe(true)
    expect(matchesUserPattern("https://safe.com", "(a+)+")).toBe(false)
  })

  it("caps tested input length", () => {
    const longUrl = `https://example.com/?q=${"x".repeat(10000)}end`
    // "end" sits beyond the cap — pattern must not see it
    expect(matchesUserPattern(longUrl, "end$")).toBe(false)
  })
})
