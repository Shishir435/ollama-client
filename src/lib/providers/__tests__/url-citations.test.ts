import { MAX_WEB_CITATIONS } from "@ollama-client/contracts/chat"
import { describe, expect, it } from "vitest"
import { readUrlCitations } from "@/lib/providers/url-citations"

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

  it("keeps the first cap's worth of a batch the stream schema would reject whole", () => {
    const batch = Array.from({ length: 20 }, (_, index) =>
      cite(`https://a.example/${index % 18}`)
    )
    const citations = readUrlCitations(batch)
    expect(citations).toHaveLength(MAX_WEB_CITATIONS)
    expect(new Set(citations.map(({ url }) => url)).size).toBe(
      MAX_WEB_CITATIONS
    )
    expect(citations[0]?.url).toBe("https://a.example/0")
  })

  it("trims an overlong title rather than dropping the citation", () => {
    const [citation] = readUrlCitations([
      cite("https://a.example", "x".repeat(600))
    ])
    expect(citation?.title).toHaveLength(512)
  })
})
