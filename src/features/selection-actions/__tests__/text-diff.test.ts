import { describe, expect, it } from "vitest"
import { compareSelectionText } from "../text-diff"

describe("selection text comparison", () => {
  it.each([
    ["", ""],
    ["old", "new"],
    ["", "inserted"],
    ["deleted", ""],
    ["Same text.", "Same text."],
    ["Keep this word and that word.", "Keep another word and a word."],
    ["hello\n\n  world", "hello\n new world"],
    ["你好，世界", "你好，朋友"],
    ["नमस्ते दुनिया", "नमस्ते मित्र"],
    ["<script>alert(1)</script>", "<b>literal markup</b>"]
  ])("preserves both versions exactly (%s → %s)", (original, proposed) => {
    const changes = compareSelectionText(original, proposed)
    expect(
      changes
        .filter((change) => change.kind !== "added")
        .map((change) => change.text)
        .join("")
    ).toBe(original)
    expect(
      changes
        .filter((change) => change.kind !== "removed")
        .map((change) => change.text)
        .join("")
    ).toBe(proposed)
  })

  it("highlights separate word edits without marking everything between them", () => {
    expect(
      compareSelectionText("A red fox runs fast.", "A blue fox runs slowly.")
    ).toEqual([
      { kind: "equal", text: "A " },
      { kind: "removed", text: "red" },
      { kind: "added", text: "blue" },
      { kind: "equal", text: " fox runs " },
      { kind: "removed", text: "fast." },
      { kind: "added", text: "slowly." }
    ])
  })

  it("bounds work for large rewrites", () => {
    const original = `prefix ${"old ".repeat(2000)}suffix`
    const proposed = `prefix ${"new ".repeat(2000)}suffix`
    const changes = compareSelectionText(original, proposed)
    expect(changes).toHaveLength(4)
    expect(changes[0]).toEqual({ kind: "equal", text: "prefix " })
    expect(changes.at(-1)).toEqual({ kind: "equal", text: " suffix" })
  })
})
