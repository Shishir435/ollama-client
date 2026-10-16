import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { GUIDES } from "@/lib/constants-ui"
import { Guides } from "../guides"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe("Guides", () => {
  it("names every external link after its guide", () => {
    render(<Guides />)
    for (const guide of GUIDES) {
      expect(
        screen.getByRole("link", { name: guide.labelKey })
      ).toHaveAttribute("target", "_blank")
    }
  })
})
