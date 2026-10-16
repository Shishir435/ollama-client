import { render, screen } from "@testing-library/react"
import { Virtuoso } from "react-virtuoso"
import { describe, expect, it } from "vitest"
import { SCROLL_REGION_FOCUS_CLASS, scrollRegionProps } from "../scroll-region"

describe("scroll region", () => {
  it("names a virtualized scroller and draws a focus outline inside it", () => {
    render(
      <Virtuoso
        data={["a", "b"]}
        {...scrollRegionProps("Conversation")}
        className={SCROLL_REGION_FOCUS_CLASS}
        itemContent={(_index, item) => <div>{item}</div>}
      />
    )
    const region = screen.getByRole("region", { name: "Conversation" })
    expect(region).toHaveAttribute("tabindex", "0")
    expect(region.getAttribute("data-virtuoso-scroller")).toBe("true")
    /** Virtuoso's inline `outline: none` would beat every focus class. */
    expect(region.style.outline).toBe("")
    expect(region.className).toContain("focus-visible:outline-2")
    /** `outline-none` sets the style to none; width alone draws nothing. */
    expect(region.className).toContain("focus-visible:outline-solid")
    expect(region.className).toContain("focus-visible:-outline-offset-2")
  })
})
