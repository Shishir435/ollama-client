import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { ChatArtifact } from "@/lib/artifacts"
import { ArtifactPreview, previewSrcDoc } from "../artifact-preview"

describe("ArtifactPreview", () => {
  it("renders a sandboxed iframe for HTML artifacts", () => {
    render(
      <ArtifactPreview
        artifact={{
          id: "html-1",
          kind: "html",
          language: "html",
          title: "HTML artifact 1",
          content: "<section>Hello artifact</section>",
          renderable: true
        }}
      />
    )

    const iframe = screen.getByTitle("HTML artifact 1")
    expect(iframe).toHaveAttribute("sandbox", "allow-scripts")
    expect(iframe).toHaveAttribute(
      "srcDoc",
      expect.stringContaining("Hello artifact")
    )
  })

  it("shows source preview for code artifacts", () => {
    render(
      <ArtifactPreview
        artifact={{
          id: "code-1",
          kind: "code",
          language: "ts",
          title: "ts artifact 1",
          content: "const value = 1",
          renderable: false
        }}
      />
    )

    expect(screen.getByText("const value = 1")).toBeInTheDocument()
  })

  it("shows Mermaid artifacts as source text", () => {
    render(
      <ArtifactPreview
        artifact={{
          id: "mermaid-1",
          kind: "mermaid",
          language: "mermaid",
          title: "Mermaid diagram 1",
          content: "graph TD\n  A --> B",
          renderable: false
        }}
      />
    )

    expect(screen.getByText(/graph TD/)).toBeInTheDocument()
    expect(screen.getByText(/A --> B/)).toBeInTheDocument()
  })
})

describe("previewSrcDoc", () => {
  it("removes default document margin and body padding from HTML previews", () => {
    const artifact: ChatArtifact = {
      id: "html-1",
      kind: "html",
      language: "html",
      title: "HTML artifact 1",
      content:
        "<!doctype html><html><head><style>body{padding:20px}</style></head><body>Hello</body></html>",
      renderable: true
    }

    expect(previewSrcDoc(artifact)).toContain(
      "margin:0!important;padding:0!important"
    )
    expect(previewSrcDoc(artifact)).toContain("Content-Security-Policy")
  })

  it("blocks link and form navigation inside HTML previews", () => {
    const artifact: ChatArtifact = {
      id: "html-1",
      kind: "html",
      language: "html",
      title: "HTML artifact 1",
      content: '<a href="/next">Next</a><form></form>',
      renderable: true
    }

    expect(previewSrcDoc(artifact)).toContain(
      'document.addEventListener("click"'
    )
    expect(previewSrcDoc(artifact)).toContain(
      'document.addEventListener("submit"'
    )
  })

  it("wraps SVG with a restrictive CSP document", () => {
    const artifact: ChatArtifact = {
      id: "svg-1",
      kind: "svg",
      language: "svg",
      title: "SVG artifact 1",
      content: "<svg></svg>",
      renderable: true
    }

    expect(previewSrcDoc(artifact)).toContain("Content-Security-Policy")
    expect(previewSrcDoc(artifact)).toContain("<svg></svg>")
  })
})
