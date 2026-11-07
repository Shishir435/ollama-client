import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { mergeTags, SessionTagsDialog } from "../session-tags-dialog"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { tag?: string }) =>
      options?.tag ? `${key}:${options.tag}` : key
  })
}))

describe("mergeTags", () => {
  it("trims, strips #, ignores empties and dedupes ignoring case", () => {
    expect(mergeTags(["Work"], " #work, ,research,  ,Research ")).toEqual([
      "Work",
      "research"
    ])
  })
})

describe("SessionTagsDialog", () => {
  it("adds chips on Enter and comma and saves them cleaned", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <SessionTagsDialog
        open
        onOpenChange={vi.fn()}
        tags={["alpha"]}
        onSave={onSave}
      />
    )
    const input = screen.getByRole("textbox", { name: "sessions.tags.title" })
    fireEvent.change(input, { target: { value: "beta," } })
    fireEvent.change(input, { target: { value: " ALPHA " } })
    fireEvent.keyDown(input, { key: "Enter" })
    fireEvent.change(input, { target: { value: "gamma" } })
    fireEvent.click(screen.getByRole("button", { name: "common.save" }))

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(["alpha", "beta", "gamma"])
    )
  })

  it("removes a chip", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <SessionTagsDialog
        open
        onOpenChange={vi.fn()}
        tags={["alpha", "beta"]}
        onSave={onSave}
      />
    )
    fireEvent.click(
      screen.getByRole("button", { name: "sessions.tags.remove:alpha" })
    )
    fireEvent.click(screen.getByRole("button", { name: "common.save" }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(["beta"]))
  })
})
