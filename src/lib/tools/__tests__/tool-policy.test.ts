import { describe, expect, it } from "vitest"
import { resolveToolRuntimePolicy } from "../tool-policy"
import type { ToolDefinition } from "../types"

const definition: ToolDefinition = {
  name: "fast_tool",
  description: "Fast",
  parameters: { type: "object", properties: {} },
  cacheable: true,
  runtime: {
    timeoutMs: 5000,
    maxResultChars: 500,
    parallelizable: false
  }
}

describe("resolveToolRuntimePolicy", () => {
  it("applies tool-level runtime policy over defaults", () => {
    expect(resolveToolRuntimePolicy(definition)).toMatchObject({
      timeoutMs: 5000,
      maxResultChars: 500,
      cacheable: true,
      parallelizable: false,
      enabled: true
    })
  })

  it("lets caller overrides win over tool policy", () => {
    expect(
      resolveToolRuntimePolicy(definition, { maxResultChars: 1000 })
    ).toMatchObject({
      maxResultChars: 1000,
      timeoutMs: 5000
    })
  })
})
