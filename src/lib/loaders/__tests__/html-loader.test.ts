import { describe, it, expect } from "vitest"
import { HtmlLoader } from "../html-loader"

describe("HtmlLoader", () => {
  describe("load", () => {
    it("should convert simple HTML to Markdown", async () => {
      const html = `
        <h1>Title</h1>
        <p>This is a paragraph.</p>
        <ul>
          <li>Item 1</li>
          <li>Item 2</li>
        </ul>
      `

      const loader = new HtmlLoader({
        html,
        url: "test.html"
      })

      const docs = await loader.load()

      expect(docs).toHaveLength(1)
      expect(docs[0].pageContent).toContain("# Title")
      expect(docs[0].pageContent).toContain("This is a paragraph")
      // Turndown formats list items with leading spaces
      expect(docs[0].pageContent).toContain("*   Item 1")
      expect(docs[0].pageContent).toContain("*   Item 2")
      expect(docs[0].metadata.source).toBe("test.html")
      expect(docs[0].metadata.type).toBe("html")
    })

    it("should preserve links in Markdown", async () => {
      const html = `<p>Visit <a href="https://example.com">this link</a></p>`

      const loader = new HtmlLoader({
        html,
        url: "test.html"
      })

      const docs = await loader.load()

      expect(docs[0].pageContent).toContain("[this link](https://example.com)")
    })

    it("should handle code blocks", async () => {
      const html = `<pre><code>const x = 42;</code></pre>`

      const loader = new HtmlLoader({
        html,
        url: "test.html"
      })

      const docs = await loader.load()

      expect(docs[0].pageContent).toContain("```")
      expect(docs[0].pageContent).toContain("const x = 42;")
    })

    it("should handle empty HTML", async () => {
      const html = ""

      const loader = new HtmlLoader({
        html,
        url: "test.html"
      })

      const docs = await loader.load()

      expect(docs).toHaveLength(1)
      expect(docs[0].pageContent).toBe("")
    })
  })
})
