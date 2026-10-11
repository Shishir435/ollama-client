import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { UnifiedSourcesButton } from "../unified-sources-button"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe("UnifiedSourcesSheet", () => {
  it("shows provider citations without loading remote images, including expanded rows", () => {
    render(
      <UnifiedSourcesButton
        webCitations={Array.from({ length: 5 }, (_, index) => ({
          url: `https://source-${index}.test/page`,
          title: `Source ${index}`
        }))}
      />
    )

    fireEvent.click(
      screen.getByRole("button", { name: "chat.sources.unified_aria" })
    )
    expect(screen.getAllByRole("link")).toHaveLength(4)
    expect(document.querySelector("img")).toBeNull()

    fireEvent.click(
      screen.getByRole("button", { name: /chat.sources.show_more/ })
    )
    fireEvent.click(screen.getByRole("button", { name: "Source 4" }))
    expect(screen.getAllByRole("link")).toHaveLength(5)
    expect(screen.getByRole("link", { name: "source-4.test" })).toHaveAttribute(
      "href",
      "https://source-4.test/page"
    )
    expect(document.querySelector("img")).toBeNull()
  })
})
