import { describe, expect, it } from "vitest"
import type { ToolDefinition } from "@/lib/tools"
import { buildToolSystemGuidance } from "../build-tool-system-guidance"

const tool = (name: string): ToolDefinition => ({
  name,
  description: name,
  parameters: { type: "object", properties: {} }
})

describe("buildToolSystemGuidance", () => {
  it("returns empty guidance without tools", () => {
    expect(buildToolSystemGuidance(undefined)).toBe("")
    expect(buildToolSystemGuidance([])).toBe("")
  })

  it("lists available tools and tells the model to use tool output", () => {
    const guidance = buildToolSystemGuidance([tool("file_search")])
    expect(guidance).toContain("file_search")
    expect(guidance).toContain("Use tool output as source of truth")
  })

  it("adds tab-specific rules when tab tools are present", () => {
    const guidance = buildToolSystemGuidance([tool("current_tab")])
    expect(guidance).toContain("force=true")
    expect(guidance).toContain("Chrome Web Store/internal page")
  })
})
