import { describe, expect, it } from "vitest"
import {
  buildFtsMatch,
  HIGHLIGHT_CLOSE,
  HIGHLIGHT_OPEN,
  highlightTerms,
  likePattern,
  parseHighlightedSnippet,
  searchTerms
} from "../message-search"

describe("searchTerms", () => {
  it("keeps words and drops everything FTS5 would read as syntax", () => {
    expect(searchTerms('  "NEAR(a b)" -x* col:y ^z ')).toEqual([
      "NEAR",
      "a",
      "b",
      "x",
      "col",
      "y",
      "z"
    ])
  })

  it("keeps non-latin and fullwidth words as typed, like the index stores them", () => {
    expect(searchTerms("日本語 ｆｕｌｌｗｉｄｔｈ naïve")).toEqual([
      "日本語",
      "ｆｕｌｌｗｉｄｔｈ",
      "naïve"
    ])
  })

  it("bounds how many terms and how long each is", () => {
    const terms = searchTerms(`${"a".repeat(200)} ${"b ".repeat(20)}`)
    expect(terms).toHaveLength(8)
    expect(terms[0]).toHaveLength(64)
  })

  it("is empty for punctuation and blanks", () => {
    expect(searchTerms('"*()-:^ ')).toEqual([])
    expect(searchTerms("")).toEqual([])
  })
})

describe("buildFtsMatch", () => {
  it("requires every word and makes the last one a prefix", () => {
    expect(buildFtsMatch(["quarterly", "invoi"])).toBe('"quarterly" "invoi"*')
    expect(buildFtsMatch(["one"])).toBe('"one"*')
  })

  it("is null when there is nothing to search", () => {
    expect(buildFtsMatch([])).toBeNull()
  })
})

describe("likePattern", () => {
  it("escapes wildcards so they match literally", () => {
    expect(likePattern("50%_off\\")).toBe("%50\\%\\_off\\\\%")
  })
})

describe("snippets", () => {
  it("splits a bracketed excerpt into text and match parts", () => {
    expect(
      parseHighlightedSnippet(
        `…the ${HIGHLIGHT_OPEN}invoice${HIGHLIGHT_CLOSE} is <b>late</b>`
      )
    ).toEqual([
      { text: "…the ", match: false },
      { text: "invoice", match: true },
      { text: " is <b>late</b>", match: false }
    ])
  })

  it("marks every occurrence of every term and merges overlaps", () => {
    expect(highlightTerms("Foo food bar", ["foo", "food"])).toEqual([
      { text: "Foo", match: true },
      { text: " ", match: false },
      { text: "food", match: true },
      { text: " bar", match: false }
    ])
    expect(highlightTerms("nothing here", ["zzz"])).toEqual([
      { text: "nothing here", match: false }
    ])
  })
})
