import { describe, expect, it } from "vitest"
import {
  agentRoleIsActivatable,
  agentRoleIsClickable,
  agentRoleName
} from "../agent-observation"

describe("agent roles", () => {
  it("reads a role as the raw attribute, lowercased", () => {
    expect(agentRoleName("BUTTON")).toBe("button")
    expect(agentRoleName(undefined)).toBe("")
    expect(agentRoleName(null)).toBe("")
  })

  it("counts a widget role as clickable in any case", () => {
    expect(agentRoleIsClickable("Tab")).toBe(true)
    expect(agentRoleIsClickable("switch")).toBe(true)
  })

  it("refuses what the click check refuses: a token list, padding, a landmark", () => {
    expect(agentRoleIsClickable("button link")).toBe(false)
    expect(agentRoleIsClickable(" button")).toBe(false)
    expect(agentRoleIsClickable("group")).toBe(false)
    expect(agentRoleIsClickable(undefined)).toBe(false)
  })

  it("adds the roles that take a value, without making them clickable", () => {
    expect(agentRoleIsActivatable("textbox")).toBe(true)
    expect(agentRoleIsClickable("textbox")).toBe(false)
    expect(agentRoleIsActivatable("group")).toBe(false)
  })
})
