import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import {
  ListRow,
  ListRowButton,
  ListRowDescription,
  ListRowTitle,
  ListRowTitleButton
} from "../list-row"

const rowOf = (testId: string) => screen.getByTestId(testId)

describe("ListRow geometry", () => {
  it("drops the leading track when there is no leading slot", () => {
    render(
      <ListRow data-testid="row">
        <ListRowTitle>Only a title</ListRowTitle>
      </ListRow>
    )

    const row = rowOf("row")
    // An empty `auto` track would still take a column gap — the phantom gutter
    // this primitive exists to prevent.
    expect(row.className).toContain("grid-cols-[minmax(0,1fr)]")
    expect(row.className).not.toContain("auto")
  })

  it("adds a trailing track only when a trailing slot is passed", () => {
    const { rerender } = render(
      <ListRow data-testid="row" leading={<span>i</span>}>
        <ListRowTitle>Title</ListRowTitle>
      </ListRow>
    )
    expect(rowOf("row").className).toContain("grid-cols-[auto_minmax(0,1fr)]")

    rerender(
      <ListRow
        data-testid="row"
        leading={<span>i</span>}
        trailing={<span>x</span>}>
        <ListRowTitle>Title</ListRowTitle>
      </ListRow>
    )
    expect(rowOf("row").className).toContain(
      "grid-cols-[auto_minmax(0,1fr)_auto]"
    )
  })

  it("places the content and below slots in the same column", () => {
    render(
      <ListRow
        data-testid="row"
        leading={<span data-testid="lead">i</span>}
        trailing={<span data-testid="trail">x</span>}
        below={<span data-testid="below">more</span>}>
        <ListRowTitle>Title</ListRowTitle>
      </ListRow>
    )

    const content = screen.getByText("Title").parentElement
    const below = screen.getByTestId("below").parentElement
    expect(content?.className).toContain("col-start-2")
    expect(below?.className).toContain("col-start-2")
    expect(below?.className).toContain("row-start-2")
    expect(screen.getByTestId("trail").parentElement?.className).toContain(
      "col-start-3"
    )
  })

  it("pays a smaller trailing box inset when the trailing slot is a control", () => {
    const { rerender } = render(
      <ListRow data-testid="row" trailing={<span>x</span>}>
        <ListRowTitle>Title</ListRowTitle>
      </ListRow>
    )
    expect(rowOf("row").className).toContain("pr-2.5")

    rerender(
      <ListRow
        data-testid="row"
        trailingKind="control"
        trailing={<button type="button">x</button>}>
        <ListRowTitle>Title</ListRowTitle>
      </ListRow>
    )
    expect(rowOf("row").className).toContain("pr-1")
    expect(rowOf("row").className).not.toContain("pr-2.5")
  })

  it("keeps the content edge fixed when the row is nested in a padded list", () => {
    const { rerender } = render(
      <ListRow data-testid="row">
        <ListRowTitle>Title</ListRowTitle>
      </ListRow>
    )
    expect(rowOf("row").className).toContain("pl-2.5")

    rerender(
      <ListRow data-testid="row" inset="nested">
        <ListRowTitle>Title</ListRowTitle>
      </ListRow>
    )
    expect(rowOf("row").className).toContain("pl-1.5")
  })
})

describe("ListRow state", () => {
  it("leaves a static row without hover or selection tint", () => {
    render(
      <ListRow data-testid="row">
        <ListRowTitle>Title</ListRowTitle>
      </ListRow>
    )
    const { className } = rowOf("row")
    expect(className).not.toContain("hover:bg-muted")
    expect(className).not.toContain("bg-muted/55")
  })

  it("tints a selectable row and still offers hover when unselected", () => {
    const { rerender } = render(
      <ListRow data-testid="row" active={false}>
        <ListRowTitle>Title</ListRowTitle>
      </ListRow>
    )
    expect(rowOf("row").className).toContain("hover:bg-muted/35")
    expect(rowOf("row").className).toContain("text-muted-foreground")
    expect(rowOf("row").className).not.toContain("bg-muted/55")

    rerender(
      <ListRow data-testid="row" active>
        <ListRowTitle>Title</ListRowTitle>
      </ListRow>
    )
    expect(rowOf("row").className).toContain("bg-muted/55")
  })

  it("gives every whole-row button hover feedback without a selection state", () => {
    render(
      <ListRowButton data-testid="row">
        <ListRowTitle>Title</ListRowTitle>
      </ListRowButton>
    )
    expect(rowOf("row").className).toContain("hover:bg-muted/35")
    expect(rowOf("row").className).not.toContain("bg-muted/55")
  })
})

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

  it("truncates the title and the description rather than wrapping", () => {
    render(
      <ListRow description={<ListRowDescription>Formats</ListRowDescription>}>
        <ListRowTitle>Upload files</ListRowTitle>
      </ListRow>
    )
    expect(screen.getByText("Upload files").className).toContain("truncate")
    expect(screen.getByText("Formats").className).toContain("truncate")
  })

  it("centres the trailing control on a two-line label", () => {
    render(
      <ListRow
        leading={<span data-testid="lead">i</span>}
        description={<ListRowDescription>Formats</ListRowDescription>}
        trailing={<button data-testid="trail" type="button" />}>
        <ListRowTitle>Upload files</ListRowTitle>
      </ListRow>
    )

    // The description is part of the label, so the leading glyph and the
    // trailing control span both lines instead of hugging the title.
    expect(screen.getByTestId("lead").parentElement?.className).toContain(
      "-row-end-1"
    )
    expect(screen.getByTestId("trail").parentElement?.className).toContain(
      "-row-end-1"
    )
  })

  it("keeps the trailing control on the title line when the second line is its own block", () => {
    render(
      <ListRow
        leading={<span data-testid="lead">i</span>}
        below={<button type="button">Preview</button>}
        trailing={<button data-testid="trail" type="button" />}>
        <ListRowTitle>A tab</ListRowTitle>
      </ListRow>
    )

    expect(screen.getByTestId("trail").parentElement?.className).not.toContain(
      "-row-end-1"
    )
    expect(screen.getByTestId("lead").parentElement?.className).not.toContain(
      "-row-end-1"
    )
  })
})
