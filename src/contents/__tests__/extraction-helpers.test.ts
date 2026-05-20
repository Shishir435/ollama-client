import { describe, expect, it } from "vitest"

import {
  detectSiteProfile,
  htmlToPlainText,
  measureReliability,
  quickHash,
  stripHtmlIfNeeded
} from "../extraction-helpers"

describe("htmlToPlainText", () => {
  it("strips HTML tags", () => {
    expect(htmlToPlainText("<p>hello <b>world</b></p>")).toBe("hello world")
  })

  it("normalizes whitespace (collapses runs of newlines/spaces but preserves paragraph breaks)", () => {
    // normalizeWhitespaceForLLM keeps paragraph breaks as \n\n,
    // and collapses internal runs of spaces/tabs/3+ newlines.
    expect(htmlToPlainText("<div>  a\n\n\nb   </div>")).toBe("a\n\nb")
    expect(htmlToPlainText("<div>a   b</div>")).toBe("a b")
  })

  it("handles empty input", () => {
    expect(htmlToPlainText("")).toBe("")
  })

  it("handles malformed HTML gracefully (parser closes tags itself)", () => {
    // happy-dom auto-closes unbalanced tags; we just care textContent is sane
    const result = htmlToPlainText("<div><b>still here")
    expect(result).toBe("still here")
  })
})

describe("stripHtmlIfNeeded", () => {
  it("leaves plain text alone", () => {
    expect(stripHtmlIfNeeded("just a sentence.")).toBe("just a sentence.")
  })

  it("strips HTML when present", () => {
    expect(stripHtmlIfNeeded("<p>hello</p>")).toBe("hello")
  })

  it("does not get fooled by < or > used as math", () => {
    // No tag-like sequence, so this is plain text
    expect(stripHtmlIfNeeded("5 < 10 and 10 > 5")).toBe("5 < 10 and 10 > 5")
  })

  it("strips when there is even a single tag-like fragment", () => {
    const input = "<br/>hello there"
    expect(stripHtmlIfNeeded(input)).toBe("hello there")
  })
})

describe("quickHash", () => {
  it("is deterministic", () => {
    expect(quickHash("hello world")).toBe(quickHash("hello world"))
  })

  it("returns different hashes for different inputs", () => {
    expect(quickHash("abc")).not.toBe(quickHash("abd"))
  })

  it("returns an unsigned-decimal string", () => {
    const h = quickHash("anything")
    expect(h).toMatch(/^\d+$/)
  })

  it("handles empty string", () => {
    expect(quickHash("")).toBe("0")
  })
})

describe("detectSiteProfile", () => {
  it.each<[string, string]>([
    ["https://youtube.com/watch?v=abc", "video"],
    ["https://vimeo.com/123", "video"],
    ["https://example.com/docs/getting-started", "docs"],
    ["https://something.readthedocs.io/", "docs"],
    ["https://developer.mozilla.org/", "docs"],
    ["https://example.com/blog/post", "blog"],
    ["https://medium.com/foo", "blog"],
    ["https://writer.substack.com/p/x", "blog"],
    ["https://news.example.com/", "news"],
    ["https://nytimes.com/2024/01/01/", "news"],
    ["https://theguardian.com/", "news"],
    ["https://reddit.com/r/anything", "forum"],
    ["https://discuss.example.com/", "forum"],
    ["https://forum.example.com/", "forum"],
    ["https://random.example.com/page", "general"]
  ])("maps %s -> %s", (url, expected) => {
    expect(detectSiteProfile(url)).toBe(expected)
  })

  it("is case-insensitive", () => {
    expect(detectSiteProfile("https://YouTube.com/watch")).toBe("video")
  })
})

describe("measureReliability", () => {
  it("gives high score to dense word content", () => {
    const content =
      "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua."
    const { reliabilityScore, reliabilitySignals } = measureReliability(content)
    expect(reliabilityScore).toBeGreaterThan(0.7)
    expect(reliabilitySignals.boilerplateRatio).toBe(0)
  })

  it("penalizes boilerplate-heavy text", () => {
    const content =
      "cookie cookie privacy privacy terms terms subscribe subscribe advertisement"
    const { reliabilityScore, reliabilitySignals } = measureReliability(content)
    expect(reliabilitySignals.boilerplateRatio).toBeGreaterThan(0.5)
    expect(reliabilityScore).toBeLessThan(0.9)
  })

  it("penalizes noisy character runs", () => {
    const content = "real words mixed with #### >>>> {{{{ ==== noise"
    const { reliabilitySignals } = measureReliability(content)
    expect(reliabilitySignals.noiseRatio).toBeGreaterThan(0)
  })

  it("rounds signal numbers to three decimals", () => {
    const { reliabilitySignals } = measureReliability("abc def ghi")
    for (const v of Object.values(reliabilitySignals)) {
      // 1.000 stays 1, otherwise at most 3 fractional digits
      const fractional = v.toString().split(".")[1] ?? ""
      expect(fractional.length).toBeLessThanOrEqual(3)
    }
  })

  it("never returns a score outside [0, 1]", () => {
    for (const sample of ["", "x", "#####", "the quick brown fox"]) {
      const { reliabilityScore } = measureReliability(sample)
      expect(reliabilityScore).toBeGreaterThanOrEqual(0)
      expect(reliabilityScore).toBeLessThanOrEqual(1)
    }
  })
})
