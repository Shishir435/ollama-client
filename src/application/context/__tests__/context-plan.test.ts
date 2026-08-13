import { describe, expect, it } from "vitest"
import { createContextPlan, remainingRagBudget } from "../context-plan"

describe("context plan", () => {
  it("normalizes the fallback query and bounded RAG budget", () => {
    const plan = createContextPlan({
      rawInput: "",
      maxRagContextChars: 500,
      groundedOnlyMode: false,
      retrievalToolsActive: false
    })

    expect(plan).toEqual({
      userContent: "",
      initialRetrievalQuery: "summary",
      ragBudget: 500,
      injectStoredContext: true
    })
    expect(remainingRagBudget(plan, 125)).toBe(375)
    expect(remainingRagBudget(plan, 700)).toBe(0)
  })

  it("treats a non-positive cap as unlimited", () => {
    const plan = createContextPlan({
      rawInput: "question",
      maxRagContextChars: 0,
      groundedOnlyMode: false,
      retrievalToolsActive: false
    })

    expect(plan.initialRetrievalQuery).toBe("question")
    expect(plan.ragBudget).toBe(Number.POSITIVE_INFINITY)
    expect(remainingRagBudget(plan, 10_000)).toBe(Number.POSITIVE_INFINITY)
  })

  it.each([
    { groundedOnlyMode: true, retrievalToolsActive: false },
    { groundedOnlyMode: false, retrievalToolsActive: true },
    { groundedOnlyMode: true, retrievalToolsActive: true }
  ])("does not pre-inject stored context for policy $groundedOnlyMode/$retrievalToolsActive", ({
    groundedOnlyMode,
    retrievalToolsActive
  }) => {
    const plan = createContextPlan({
      rawInput: "question",
      maxRagContextChars: 500,
      groundedOnlyMode,
      retrievalToolsActive
    })

    expect(plan.injectStoredContext).toBe(false)
  })
})
