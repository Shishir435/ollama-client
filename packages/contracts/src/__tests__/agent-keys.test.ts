import { describe, expect, it } from "vitest"

import { AgentCommandSchema } from "../agent-command"
import {
  AgentKeyCombinationSchema,
  formatAgentKeyCombination,
  parseAgentKeyCombination
} from "../agent-keys"

describe("Agent key combinations", () => {
  it("parses named keys, characters and modifier chords in canonical order", () => {
    expect(parseAgentKeyCombination("Enter")).toEqual({
      modifiers: [],
      key: "Enter"
    })
    expect(parseAgentKeyCombination("a")).toEqual({ modifiers: [], key: "a" })
    expect(parseAgentKeyCombination("Shift+Tab")).toEqual({
      modifiers: ["Shift"],
      key: "Tab"
    })
    expect(parseAgentKeyCombination("Shift+Control+a")).toEqual({
      modifiers: ["Control", "Shift"],
      key: "a"
    })
    expect(
      formatAgentKeyCombination(
        parseAgentKeyCombination("Shift+Control+a") as never
      )
    ).toBe("Control+Shift+a")
  })

  it("refuses unknown keys, repeated modifiers, empty tokens and whitespace", () => {
    for (const value of [
      "",
      "F5",
      "Control+",
      "+a",
      "Control+Control+a",
      "shift+Tab",
      " ",
      "Enter ",
      "ab",
      "Control+ab"
    ]) {
      expect(parseAgentKeyCombination(value), value).toBeUndefined()
      expect(AgentKeyCombinationSchema.safeParse(value).success, value).toBe(
        false
      )
    }
  })

  it("admits chords through the press_key command and refuses invented keys", () => {
    const grounded = { snapshotId: "s1", generation: 1, ref: "e1" }
    expect(
      AgentCommandSchema.safeParse({
        ...grounded,
        type: "press_key",
        key: "Control+a"
      }).success
    ).toBe(true)
    expect(
      AgentCommandSchema.safeParse({
        ...grounded,
        type: "press_key",
        key: "F12"
      }).success
    ).toBe(false)
    expect(
      AgentCommandSchema.safeParse({ ...grounded, type: "double_click" })
        .success
    ).toBe(true)
    expect(
      AgentCommandSchema.safeParse({ ...grounded, type: "hover" }).success
    ).toBe(true)
  })
})
