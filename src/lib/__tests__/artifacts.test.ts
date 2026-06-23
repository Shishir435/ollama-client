import { describe, expect, it } from "vitest"
import { extractChatArtifacts } from "@/lib/artifacts"

describe("extractChatArtifacts", () => {
  it("extracts renderable HTML, SVG, and Mermaid fenced blocks", () => {
    const artifacts = extractChatArtifacts(`
Text
\`\`\`html
<main><h1>Hello</h1></main>
\`\`\`

\`\`\`svg
<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" /></svg>
\`\`\`

\`\`\`mermaid
graph TD
  A --> B
\`\`\`
`)

    expect(artifacts).toHaveLength(3)
    expect(artifacts[0]).toMatchObject({
      kind: "html",
      language: "html",
      renderable: true
    })
    expect(artifacts[1]).toMatchObject({
      kind: "svg",
      language: "svg",
      renderable: true
    })
    expect(artifacts[2]).toMatchObject({
      kind: "mermaid",
      language: "mermaid",
      renderable: true
    })
  })

  it("keeps non-renderable code artifacts as source previews", () => {
    const artifacts = extractChatArtifacts(`
\`\`\`ts
export const value = 1
\`\`\`
`)

    expect(artifacts).toEqual([
      expect.objectContaining({
        kind: "code",
        language: "ts",
        renderable: false,
        content: "export const value = 1"
      })
    ])
  })

  it("ignores unsupported fences", () => {
    expect(
      extractChatArtifacts(`
\`\`\`
plain
\`\`\`
`)
    ).toEqual([])
  })

  it("does not treat generic XML as SVG", () => {
    expect(
      extractChatArtifacts(`
\`\`\`xml
<rss><channel><title>Feed</title></channel></rss>
\`\`\`
`)
    ).toEqual([])
  })
})
