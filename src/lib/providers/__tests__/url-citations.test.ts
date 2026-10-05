import { MAX_WEB_CITATIONS } from "@ollama-client/contracts/chat"
import { describe, expect, it } from "vitest"
import {
  createUrlCitationCollector,
  readUrlCitations
} from "@/lib/providers/url-citations"

const cite = (url: string, title?: string) => ({
  type: "url_citation",
  url_citation: { url, ...(title === undefined ? {} : { title }) }
})

describe("readUrlCitations", () => {
  it("keeps http(s) citations and drops everything a link must not be", () => {
    expect(
      readUrlCitations([
        cite("https://a.example/page", "  A page  "),
        cite("http://b.example"),
        cite("javascript:alert(1)", "script"),
        cite("data:text/html,<b>x</b>"),
        cite("not a url"),
        { type: "file_citation", file_id: "f1" },
        "https://loose.example",
        null
      ])
    ).toEqual([
      { url: "https://a.example/page", title: "A page" },
      { url: "http://b.example" }
    ])
  })

  it("treats a missing or non-array value as no citations", () => {
    expect(readUrlCitations(undefined)).toEqual([])
    expect(readUrlCitations({ type: "url_citation" })).toEqual([])
  })

  it("trims an overlong title rather than dropping the citation", () => {
    const [citation] = readUrlCitations([
      cite("https://a.example", "x".repeat(600))
    ])
    expect(citation?.title).toHaveLength(512)
  })
})

describe("createUrlCitationCollector", () => {
  it("deduplicates by URL and fills a title the first report lacked", () => {
    const collector = createUrlCitationCollector()
    expect(collector.add([cite("https://a.example")])).toBe(true)
    expect(collector.add([cite("https://a.example")])).toBe(false)
    expect(collector.add([cite("https://a.example", "A")])).toBe(true)
    expect(collector.list()).toEqual([{ url: "https://a.example", title: "A" }])
  })

  it("stops at what a message persists", () => {
    const collector = createUrlCitationCollector()
    collector.add(
      Array.from({ length: MAX_WEB_CITATIONS + 5 }, (_, index) =>
        cite(`https://a.example/${index}`)
      )
    )
    expect(collector.list()).toHaveLength(MAX_WEB_CITATIONS)
  })
})
