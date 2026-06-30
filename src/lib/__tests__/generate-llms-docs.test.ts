import { describe, expect, it } from "vitest"
import { cleanMarkdown } from "../../../tools/generate-llms-docs"

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
