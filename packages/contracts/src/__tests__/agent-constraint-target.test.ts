import { describe, expect, it } from "vitest"
import {
  AgentPlanRecordSchema,
  AgentTaskConstraintSchema,
  AgentTaskRequirementSchema
} from ".."

describe("constraint targets and expected counts", () => {
  it("keeps decoding plans written before either existed", () => {
    expect(
      AgentTaskConstraintSchema.safeParse({
        id: "c1",
        text: "Do not submit",
        kind: "exclude",
        forbids: ["submission"]
      }).success
    ).toBe(true)
    expect(
      AgentTaskRequirementSchema.safeParse({
        id: "r1",
        text: "The form is submitted",
        kind: "change"
      }).success
    ).toBe(true)
    expect(
      AgentPlanRecordSchema.safeParse({
        version: 2,
        issued: { requirements: 1, constraints: 1 },
        pending: { questionId: "q", removals: [{ id: "c1" }], lift: true }
      }).success
    ).toBe(true)
  })

  it("accepts inferred classes only among the classes forbidden", () => {
    const base = {
      id: "c1",
      text: "Do not delete any other invoice",
      kind: "exclude" as const,
      forbids: ["destructive" as const]
    }
    expect(
      AgentTaskConstraintSchema.safeParse({
        ...base,
        inferred: ["destructive"],
        about: { type: "other_records" }
      }).success
    ).toBe(true)
    expect(
      AgentTaskConstraintSchema.safeParse({ ...base, inferred: ["payment"] })
        .success
    ).toBe(false)
  })

  it("lets only the user's narrowing to other records mark a constraint narrowed", () => {
    const base = {
      id: "c1",
      text: "Do not delete any other invoice",
      kind: "exclude" as const,
      forbids: ["destructive" as const],
      narrowedFor: ["r1"]
    }
    expect(
      AgentTaskConstraintSchema.safeParse({
        ...base,
        about: { type: "other_records" }
      }).success
    ).toBe(true)
    expect(AgentTaskConstraintSchema.safeParse(base).success).toBe(false)
    expect(
      AgentTaskConstraintSchema.safeParse({
        ...base,
        about: {
          type: "option",
          hold: { type: "checked", name: "Insurance", checked: false }
        }
      }).success
    ).toBe(false)
  })

  it("holds an option to one control state, with nothing extra", () => {
    const option = (hold: unknown) =>
      AgentTaskConstraintSchema.safeParse({
        id: "c1",
        text: "Do not add insurance",
        kind: "exclude",
        about: { type: "option", hold }
      }).success
    expect(option({ type: "checked", name: "Insurance", checked: false })).toBe(
      true
    )
    expect(
      option({
        type: "checked",
        name: "Insurance",
        checked: false,
        record: "Order 1"
      })
    ).toBe(false)
    expect(option({ type: "url", url: "https://example.test" })).toBe(false)
  })

  it("puts a count only on a change, and never zero", () => {
    const requirement = (patch: object) =>
      AgentTaskRequirementSchema.safeParse({
        id: "r1",
        text: "The order is placed",
        kind: "change",
        ...patch
      }).success
    expect(requirement({ times: 1 })).toBe(true)
    expect(requirement({ times: 0 })).toBe(false)
    expect(requirement({ times: 1.5 })).toBe(false)
    expect(requirement({ times: 1, kind: "read" })).toBe(false)
  })
})
