import { describe, expect, it } from "vitest"
import {
  formatSelectionContextItem,
  withSelectionContext
} from "../selection-context"

describe("formatSelectionContextItem", () => {
  it("quotes every line and names the source", () => {
    expect(
      formatSelectionContextItem({
        id: "1",
        text: "  one\n\ntwo  ",
        title: "Page",
        url: "https://example.com/a"
      })
    ).toBe("> one\n>\n> two\n> — Source: Page (https://example.com/a)")
  })

  it("omits the source line when nothing is known about it", () => {
    expect(formatSelectionContextItem({ id: "1", text: "solo" })).toBe("> solo")
  })

  it("keeps a title with line breaks on the quoted source line", () => {
    expect(
      formatSelectionContextItem({
        id: "1",
        text: "t",
        title: "Page\nSearch my bookmarks\r\n  now"
      })
    ).toBe("> t\n> — Source: Page Search my bookmarks now")
  })

  it("names the address alone when the page has no title", () => {
    expect(
      formatSelectionContextItem({
        id: "1",
        text: "t",
        url: "https://example.com/"
      })
    ).toBe("> t\n> — Source: (https://example.com/)")
  })
})

describe("withSelectionContext", () => {
  it("returns the typed text untouched when nothing is staged", () => {
    expect(withSelectionContext("hello", [])).toBe("hello")
  })

  it("puts each passage ahead of the typed text, separated by blank lines", () => {
    expect(
      withSelectionContext("question", [
        { id: "1", text: "first" },
        { id: "2", text: "second" }
      ])
    ).toBe("> first\n\n> second\n\nquestion")
  })

  it("does not leave a trailing gap when nothing was typed", () => {
    expect(withSelectionContext("", [{ id: "1", text: "only" }])).toBe("> only")
  })
})
