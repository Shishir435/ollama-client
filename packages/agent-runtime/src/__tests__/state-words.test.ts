import { describe, expect, it } from "vitest"
import { localeAssertsOff, localeAssertsOn } from "../state-words"

describe("state words read beside English", () => {
  it("reads an English negation of a word French shares", () => {
    expect(localeAssertsOn("the newsletter is not active")).toBe(false)
    expect(localeAssertsOff("the newsletter is not active")).toBe(true)
    expect(localeAssertsOn("the newsletter is active")).toBe(true)
  })
})
