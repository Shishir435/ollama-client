import { render, screen } from "@testing-library/react"
import { AppWindow } from "lucide-react"
import { describe, expect, it } from "vitest"
import { EmptyState } from "../empty-state"

describe("EmptyState", () => {
  it("reserves body height by default", () => {
    render(<EmptyState data-testid="state" title="Nothing here" />)
    expect(screen.getByTestId("state").className).toContain("min-h-48")
  })

  it("claims no reserved height when compact", () => {
    render(
      <EmptyState data-testid="state" density="compact" title="Nothing here" />
    )
    // A dense list has to keep showing its own rows, which is why side-panel
    // lists hand-rolled a bare paragraph while `comfortable` was the only shape.
    expect(screen.getByTestId("state").className).not.toContain("min-h-48")
  })

  it("drops the icon's badge treatment when compact", () => {
    const { rerender } = render(
      <EmptyState data-testid="state" icon={AppWindow} title="Nothing here" />
    )
    expect(screen.getByTestId("state").innerHTML).toContain("rounded-full")

    rerender(
      <EmptyState
        data-testid="state"
        density="compact"
        icon={AppWindow}
        title="Nothing here"
      />
    )
    expect(screen.getByTestId("state").innerHTML).not.toContain("rounded-full")
  })

  it("renders the description and actions it is given", () => {
    render(
      <EmptyState
        title="No tabs"
        description="Open a tab to add it"
        actions={<button type="button">Refresh</button>}
      />
    )
    expect(screen.getByText("No tabs")).toBeInTheDocument()
    expect(screen.getByText("Open a tab to add it")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument()
  })
})
