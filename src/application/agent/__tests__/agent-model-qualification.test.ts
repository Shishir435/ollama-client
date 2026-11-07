import { describe, expect, it } from "vitest"
import {
  isQualifiedAgentModel,
  QUALIFIED_AGENT_MODELS
} from "../agent-model-qualification"

describe("isQualifiedAgentModel", () => {
  it("qualifies nothing until a passing qualification report adds it", () => {
    expect(QUALIFIED_AGENT_MODELS).toEqual([])
    expect(isQualifiedAgentModel("qwen3")).toBe(false)
  })

  it("matches the exact model id a report named", () => {
    expect(
      isQualifiedAgentModel("openai/gpt-6-luna", ["openai/gpt-6-luna"])
    ).toBe(true)
    expect(isQualifiedAgentModel("openai/gpt-6", ["openai/gpt-6-luna"])).toBe(
      false
    )
  })
})
