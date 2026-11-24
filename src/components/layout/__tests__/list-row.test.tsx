import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import {
  ListRow,
  ListRowButton,
  ListRowTitle,
  ListRowTitleButton
} from "../list-row"

const rowOf = (testId: string) => screen.getByTestId(testId)

describe("ListRowButton behaviour", () => {
  it("renders a real button that defaults to type=button", () => {
    render(
      <ListRowButton data-testid="row">
        <ListRowTitle>Save</ListRowTitle>
      </ListRowButton>
    )
    const row = rowOf("row")
    expect(row.tagName).toBe("BUTTON")
    expect(row).toHaveAttribute("type", "button")
  })

  it("does not fire while disabled", () => {
    const onClick = vi.fn()
    render(
      <ListRowButton disabled onClick={onClick}>
        <ListRowTitle>Capture</ListRowTitle>
      </ListRowButton>
    )

    fireEvent.click(screen.getByRole("button", { name: "Capture" }))
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe("ListRow slots", () => {
  it("keeps the title a button when the row itself is not one", () => {
    const onToggle = vi.fn()
    render(
      <ListRow trailing={<button type="button">Preview</button>}>
        <ListRowTitleButton onClick={onToggle}>A tab</ListRowTitleButton>
      </ListRow>
    )

    const title = screen.getByRole("button", { name: "A tab" })
    expect(title.tagName).toBe("BUTTON")
    fireEvent.click(title)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
