import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ChatArtifact } from "@/lib/artifacts"
import { ArtifactCanvas, previewSrcDoc } from "../artifact-canvas"

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async () => ({
    svg: '<svg role="img"><text>Rendered Mermaid</text></svg>'
  }))
}))

vi.mock("mermaid", () => ({
  default: mermaidMock
}))

describe("ArtifactCanvas", () => {
  it("renders nothing when disabled", () => {
    const { container } = render(
      <ArtifactCanvas
        enabled={false}
        content={"```html\n<h1>Hello</h1>\n```"}
      />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it("opens a sandboxed preview for renderable artifacts", () => {
    render(
      <ArtifactCanvas
        enabled
        content={"```html\n<section>Hello artifact</section>\n```"}
      />
    )

    fireEvent.click(
      screen.getByRole("button", { name: /Preview HTML artifact 1/ })
    )

    const iframe = screen.getByTitle("HTML artifact 1")
    expect(iframe).toHaveAttribute("sandbox", "allow-scripts")
    expect(iframe).toHaveAttribute(
      "srcDoc",
      expect.stringContaining("Hello artifact")
    )
  })

  it("shows source preview for code artifacts", () => {
    render(<ArtifactCanvas enabled content={"```ts\nconst value = 1\n```"} />)

    fireEvent.click(screen.getByRole("button", { name: /Open ts artifact 1/i }))

    expect(screen.getByText("const value = 1")).toBeInTheDocument()
  })

  it("renders Mermaid artifacts as diagrams", async () => {
    render(
      <ArtifactCanvas
        enabled
        content={"```mermaid\ngraph TD\n  A --> B\n```"}
      />
    )

    fireEvent.click(
      screen.getByRole("button", { name: /Preview Mermaid diagram 1/i })
    )

    expect(await screen.findByTestId("mermaid-preview")).toContainHTML(
      "Rendered Mermaid"
    )
    expect(mermaidMock.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: "strict" })
    )
    expect(mermaidMock.render).toHaveBeenCalledWith(
      expect.stringContaining("artifact-mermaid-1"),
      "graph TD\n  A --> B"
    )
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
