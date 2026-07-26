import { readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

import { DOC_ORDER } from "../../../docs/src/seo/doc-ia.mjs"
import {
  assertIaMatches,
  cleanMarkdown
} from "../../../tools/generate-llms-docs"

describe("cleanMarkdown", () => {
  it("removes multiline MDX export declarations but keeps prose", () => {
    const markdown = `import FAQ from "./FAQ.astro"

export const faqItems = [
  {
    question: "What is Ollama Client?",
    answer: "A local-first browser extension."
  }
]

<FAQPageJsonLd items={faqItems} />

## Does it stay local?

Yes.`

    const cleaned = cleanMarkdown(markdown)

    expect(cleaned).not.toContain("export const")
    expect(cleaned).not.toContain("question:")
    expect(cleaned).not.toContain("answer:")
    expect(cleaned).not.toContain("FAQPageJsonLd")
    expect(cleaned).toContain("## Does it stay local?")
    expect(cleaned).toContain("Yes.")
  })

  it("removes single-line exported values", () => {
    expect(cleanMarkdown("export const draft = true\n\n# Public")).toBe(
      "# Public"
    )
  })

  it("strips an export whose value contains brace-bearing comments", () => {
    const markdown = `export const data = {
  // a comment with an unbalanced brace } and a quote "
  items: [
    /* block comment with { and ] */
    { q: "Q?", a: "A." }
  ]
}

# Public heading

Body text.`

    const cleaned = cleanMarkdown(markdown)

    expect(cleaned).not.toContain("export const")
    expect(cleaned).not.toContain("items:")
    expect(cleaned).not.toContain("block comment")
    expect(cleaned).toContain("# Public heading")
    expect(cleaned).toContain("Body text.")
  })

  it("removes paired-tag FAQPageJsonLd without a placeholder", () => {
    const cleaned = cleanMarkdown(
      "<FAQPageJsonLd items={faqItems}>\n  child\n</FAQPageJsonLd>\n\n# Public"
    )

    expect(cleaned).not.toContain("FAQPageJsonLd")
    expect(cleaned).not.toContain("Rendered component")
    expect(cleaned).toContain("# Public")
  })
})

const DOCS_CONTENT_DIR = join(__dirname, "../../../docs/src/content/docs")

const contentSlugs = () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry)
      return statSync(path).isDirectory() ? walk(path) : [path]
    })

  return walk(DOCS_CONTENT_DIR)
    .filter((path) => /\.(md|mdx)$/.test(path))
    .map((path) => relative(DOCS_CONTENT_DIR, path).replace(/\\/g, "/"))
    .filter((path) => !path.startsWith("reference/"))
    .map((path) => path.replace(/\.(md|mdx)$/, "").replace(/\/index$/, ""))
}

describe("docs IA", () => {
  /*
   * The generator enforces this at build time, but a build runs later than a
   * push. Failing here means a new docs page shows up in `pnpm test:run` rather
   * than silently landing at the bottom of llms.txt — the exact regression this
   * check exists for, which went unnoticed for two pages.
   */
  it("matches the content tree", () => {
    expect(() => assertIaMatches(contentSlugs())).not.toThrow()
  })

  it("names the page when the content tree has one the IA does not", () => {
    expect(() =>
      assertIaMatches([...contentSlugs(), "guides/unlisted-page"])
    ).toThrow(/guides\/unlisted-page.*not in DOC_SECTIONS/s)
  })

  it("names the page when the IA has one the content tree does not", () => {
    const withoutFirst = contentSlugs().filter((slug) => slug !== DOC_ORDER[0])

    expect(() => assertIaMatches(withoutFirst)).toThrow(
      new RegExp(`${DOC_ORDER[0]}.*has no content file`, "s")
    )
  })
})
