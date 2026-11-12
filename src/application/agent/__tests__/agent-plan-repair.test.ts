import { describe, expect, it } from "vitest"
import type { ToolCall } from "@/lib/tools/types"
import { agentPlanRepairPrompt } from "../agent-plan-repair"

const call = (arguments_: Record<string, unknown>): ToolCall => ({
  id: "plan",
  name: "agent_plan",
  arguments: arguments_
})

describe("bounded rejected-plan context", () => {
  it("keeps complete plan data but strips unknown fields and provider baggage", () => {
    const text = agentPlanRepairPrompt(
      [
        call({
          requirements: [
            {
              text: "Name holds Ada",
              kind: "change",
              source: "Set Name to Ada",
              check: {
                type: "field",
                name: "Name",
                value: "Ada",
                opaqueReplay: "DO-NOT-REPLAY-NESTED"
              }
            }
          ],
          constraints: [
            {
              kind: "exclude",
              text: "Do not submit",
              source: "Do not submit",
              forbids: ["submission"]
            }
          ],
          providerMetadata: { reasoning: "DO-NOT-REPLAY-ROOT" }
        })
      ],
      "Omit inferred page items; retain the read.",
      4_000
    )
    expect(text).toContain('"source":"Set Name to Ada"')
    expect(text).toContain('"forbids":["submission"]')
    expect(text).toContain('"value":"Ada"')
    expect(text).not.toContain("DO-NOT-REPLAY")
    expect(text.length).toBeLessThanOrEqual(4_000)
  })

  it("does not copy opaque-shaped objects through a known scalar argument", () => {
    const text = agentPlanRepairPrompt(
      [
        call({
          requirements: [
            {
              kind: "change",
              source: "Set Name to Ada",
              text: "Name holds Ada",
              check: {
                type: "field",
                name: "Name",
                value: { type: "opaque", value: "OPAQUE-OBJECT-DATA" }
              }
            }
          ]
        })
      ],
      "Repair the predicate value from the original user request.",
      4_000
    )
    expect(text).toContain('"name":"Name"')
    expect(text).toContain('"source":"Set Name to Ada"')
    expect(text).not.toContain("OPAQUE-OBJECT-DATA")
  })

  it("omits an oversized proposal whole rather than cutting sources or literals", () => {
    const text = agentPlanRepairPrompt(
      [
        call({
          requirements: [
            {
              kind: "change",
              text: "Name",
              source: "LONG-SOURCE-".repeat(2_000)
            }
          ]
        })
      ],
      "Copy a bounded source from the user request.",
      1_000
    )
    expect(text).not.toContain("LONG-SOURCE")
    expect(text).toContain("omitted")
    expect(text).toContain("Copy a bounded source")
    expect(text.length).toBeLessThanOrEqual(1_000)
  })

  it("preserves the existing feedback when no optional context fits", () => {
    expect(
      agentPlanRepairPrompt(
        [call({ requirements: [] })],
        "Return the complete plan.",
        0
      )
    ).toBe("Return the complete plan.")
  })

  it("does not choose between multiple rejected proposals or replay other tools", () => {
    for (const calls of [
      [],
      [call({ requirements: [] }), call({ requirements: [] })],
      [
        {
          id: "wrong",
          name: "other_tool",
          arguments: { source: "OTHER-TOOL-DATA" }
        }
      ]
    ]) {
      const text = agentPlanRepairPrompt(
        calls,
        "Return exactly one plan.",
        2_000
      )
      expect(text).toContain("omitted")
      expect(text).not.toContain("OTHER-TOOL-DATA")
    }
  })
})
