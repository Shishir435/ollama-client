import { AgentStepRecordSchema } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import type { DurableAgentStep } from "@/lib/repositories/agent-runs"
import { toAgentStepRecords } from "../agent-step-records"

describe("toAgentStepRecords", () => {
  /**
   * A confirmed batch fill carries its field names and a GET submission the
   * values it sent, for the completion judge. The panel's schema is strict,
   * and a record carrying either took the whole snapshot down.
   */
  it("gives the panel a verification its strict schema accepts", () => {
    const step = (
      stepId: string,
      evidence: Record<string, unknown>
    ): DurableAgentStep =>
      ({
        runId: "run-1",
        stepId,
        sequence: stepId === "s1" ? 1 : 2,
        status: "verified",
        at: 1,
        verification: {
          outcome: "confirmed",
          evidence: {
            kind: "fields",
            summary: "All 1 fields hold the resolved value",
            observedAt: 1,
            ...evidence
          }
        }
      }) as DurableAgentStep
    const records = toAgentStepRecords([
      step("s1", { fields: [{ name: "Email" }] }),
      step("s2", {
        kind: "submission",
        values: [{ name: "Search", value: "Alice" }]
      })
    ])
    for (const record of records) {
      expect(AgentStepRecordSchema.safeParse(record).success).toBe(true)
      expect(record.verification?.evidence).not.toHaveProperty("fields")
      expect(record.verification?.evidence).not.toHaveProperty("values")
    }
  })
})
