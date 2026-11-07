import { Replace } from "lucide-react"
import { describe, expect, it } from "vitest"
import { SELECTION_ACTION_COMMANDS } from "../action-commands"

describe("selection action icons", () => {
  it("gives every action its own icon, distinct from Replace", () => {
    const icons = Object.values(SELECTION_ACTION_COMMANDS).map(
      (command) => command.icon
    )

    expect(new Set(icons).size).toBe(icons.length)
    expect(icons).not.toContain(Replace)
  })
})
