import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { MarkdownRenderer } from "../markdown-renderer"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "chat.actions.copy": "Copy",
        "chat.actions.copied": "Copied",
        "chat.actions.preview": "Preview"
      })[key] ?? key
  })
}))

describe("MarkdownRenderer", () => {
  it("adds copy and preview controls to renderable code blocks", async () => {
    render(
      <MarkdownRenderer
        content={"```html\n<section>Hello preview</section>\n```"}
      />
    )

    expect(
      await screen.findByRole("button", { name: "Copy" })
    ).toBeInTheDocument()
    const preview = await screen.findByRole("button", {
      name: "Preview HTML artifact 1"
    })

    fireEvent.click(preview)

    const iframe = await screen.findByTitle("HTML artifact 1")
    expect(iframe).toHaveAttribute("sandbox", "allow-scripts")
    expect(iframe).toHaveAttribute(
      "srcDoc",
      expect.stringContaining("Hello preview")
    )
  })

  it("does not add preview to plain code blocks", async () => {
    render(<MarkdownRenderer content={"```\njust notes\n```"} />)

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument()
    })
    expect(
      screen.queryByRole("button", { name: /Preview/ })
    ).not.toBeInTheDocument()
  })

  it("numbers previews by artifacts, not all code blocks", async () => {
    render(
      <MarkdownRenderer
        content={"```\nplain notes\n```\n\n```html\n<section>Hi</section>\n```"}
      />
    )

    expect(
      await screen.findByRole("button", { name: "Preview HTML artifact 1" })
    ).toBeInTheDocument()
  })
})
