import { beforeEach, describe, expect, it, vi } from "vitest"

// We control extractor behavior per-test via these module-scoped variables.
// The class mocks below read them at construction time.
let defuddleResult: Record<string, unknown> | null = null
let readabilityResult: Record<string, unknown> | null = null
let defuddleConstructorCalls = 0
let readabilityConstructorCalls = 0

vi.mock("defuddle", () => ({
  default: class FakeDefuddle {
    constructor() {
      defuddleConstructorCalls++
    }
    parse() {
      return defuddleResult
    }
  }
}))

vi.mock("@mozilla/readability", () => ({
  Readability: class FakeReadability {
    constructor() {
      readabilityConstructorCalls++
    }
    parse() {
      return readabilityResult
    }
  }
}))

// Imports must come AFTER vi.mock so the mocks are in place.
import { extractReadableContent, resolvePageTitle } from "../content-extraction"

const setDefuddle = (result: Record<string, unknown> | null) => {
  defuddleResult = result
}
const setReadability = (result: Record<string, unknown> | null) => {
  readabilityResult = result
}

const makeDoc = (innerHTML: string, title = ""): Document => {
  const doc = document.implementation.createHTMLDocument(title)
  if (title) doc.title = title
  doc.body.innerHTML = innerHTML
  return doc
}

describe("extractReadableContent", () => {
  beforeEach(() => {
    defuddleResult = null
    readabilityResult = null
    defuddleConstructorCalls = 0
    readabilityConstructorCalls = 0
  })

  it("uses Defuddle when scraper is 'auto' and it returns rich markdown", () => {
    setDefuddle({
      contentMarkdown: "word ".repeat(60).trim(),
      title: "Defuddle Title"
    })

    const result = extractReadableContent(makeDoc(""), "auto")
    expect(result.selectedExtractor).toBe("defuddle")
    expect(result.selectedReason).toBe("defuddle-markdown")
    expect(result.pageTitle).toBe("Defuddle Title")
    expect(result.readableText.length).toBeGreaterThan(50)
  })

  it("reports defuddle-html when only HTML content is returned", () => {
    setDefuddle({
      content: `<p>${"word ".repeat(60).trim()}</p>`,
      title: "HTML-only Title"
    })

    const result = extractReadableContent(makeDoc(""), "auto")
    expect(result.selectedExtractor).toBe("defuddle")
    expect(result.selectedReason).toBe("defuddle-html")
  })

  it("falls back to Readability when Defuddle returns short content under 'auto'", () => {
    setDefuddle({ contentMarkdown: "tiny", title: "From Defuddle" })
    setReadability({
      textContent: "word ".repeat(80).trim(),
      title: "From Readability"
    })

    const result = extractReadableContent(makeDoc(""), "auto")
    expect(result.selectedExtractor).toBe("readability")
    expect(result.selectedReason).toBe("auto-readability-better")
    expect(result.pageTitle).toBe("From Readability")
  })

  it("uses Readability exclusively when scraper is 'readability'", () => {
    setReadability({
      textContent: "word ".repeat(60).trim(),
      title: "Read-Only Title"
    })

    const result = extractReadableContent(makeDoc(""), "readability")
    expect(defuddleConstructorCalls).toBe(0)
    expect(result.selectedExtractor).toBe("readability")
    expect(result.selectedReason).toBe("forced-readability")
  })

  it("does not fall back to Readability when scraper is 'defuddle' only", () => {
    setDefuddle(null)

    const result = extractReadableContent(makeDoc(""), "defuddle")
    expect(readabilityConstructorCalls).toBe(0)
    expect(result.readableText).toBe("")
    expect(result.selectedExtractor).toBe("basic")
  })

  it("falls through to body-text basic extraction when both libs fail", () => {
    setDefuddle(null)
    setReadability(null)

    const doc = makeDoc(`<p>${"word ".repeat(80).trim()}</p>`)
    const result = extractReadableContent(doc, "auto")
    expect(result.selectedExtractor).toBe("basic")
    expect(result.selectedReason).toBe("basic-body-fallback")
    expect(result.readableText.length).toBeGreaterThan(50)
  })

  it("returns an empty basic-fallback record if nothing produces meaningful text", () => {
    setDefuddle(null)
    setReadability(null)

    const result = extractReadableContent(makeDoc(""), "auto")
    expect(result.readableText).toBe("")
    expect(result.selectedExtractor).toBe("basic")
    expect(result.selectedReason).toBe("fallback-basic")
  })

  it("preserves Defuddle's title even when Readability replaces the body", () => {
    setDefuddle({ contentMarkdown: "tiny", title: "Original Defuddle" })
    setReadability({
      textContent: "word ".repeat(80).trim(),
      title: ""
    })

    const result = extractReadableContent(makeDoc(""), "auto")
    expect(result.selectedExtractor).toBe("readability")
    expect(result.pageTitle).toBe("Original Defuddle")
  })
})

describe("resolvePageTitle", () => {
  beforeEach(() => {
    document.head.innerHTML = ""
    document.title = ""
  })

  it("returns the extractor-provided title, with suffix cleanup", () => {
    const doc = makeDoc("", "doc-title")
    expect(resolvePageTitle(doc, "Real Article - Site Name")).toBe(
      "Real Article"
    )
  })

  it("falls back to og:title when the extractor returned nothing", () => {
    document.head.innerHTML = `<meta property="og:title" content="OG Title" />`
    expect(resolvePageTitle(document, "")).toBe("OG Title")
  })

  it("falls back further to twitter:title when og:title is absent", () => {
    document.head.innerHTML = `<meta name="twitter:title" content="Twitter Title" />`
    expect(resolvePageTitle(document, "")).toBe("Twitter Title")
  })

  it("falls back to meta name='title' when og and twitter are absent", () => {
    document.head.innerHTML = `<meta name="title" content="Plain Meta Title" />`
    expect(resolvePageTitle(document, "")).toBe("Plain Meta Title")
  })

  it("strips ' | SiteName' and ' : Category' suffixes", () => {
    const doc = makeDoc("", "")
    expect(resolvePageTitle(doc, "Story | The Site")).toBe("Story")
    expect(resolvePageTitle(doc, "Story : Category")).toBe("Story")
  })

  it("returns 'Untitled' as a final fallback", () => {
    const doc = makeDoc("", "")
    expect(resolvePageTitle(doc, "")).toBe("Untitled")
  })

  it("falls back to document.title when the extractor title contains 'untitled'", () => {
    const doc = makeDoc("", "Doc Title")
    expect(resolvePageTitle(doc, "Untitled - Page")).toBe("Doc Title")
  })
})
