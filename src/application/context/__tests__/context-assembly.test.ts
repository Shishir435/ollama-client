import { describe, expect, it, vi } from "vitest"
import { ACTIVITY_LABELS } from "@/application/context/activity-labels"
import { ContextAssembly } from "../context-assembly"
import { createContextPlan } from "../context-plan"

const plan = (maxRagContextChars = 100) =>
  createContextPlan({
    rawInput: "Question",
    maxRagContextChars,
    groundedOnlyMode: false
  })

describe("ContextAssembly", () => {
  it("shares one budget across stored context sources", () => {
    const assembly = new ContextAssembly(plan(10), false)
    assembly.appendStoredContext(
      "123456",
      [{ id: "f", title: "File", content: "123456", score: 0.9 }],
      "query",
      () => "file"
    )
    assembly.appendStoredContext(
      "abcdef",
      [{ id: "m", title: "Memory", content: "abcdef", score: 0.8 }],
      "query",
      () => "memory"
    )

    const result = assembly.finish()
    expect(result.promptContextStats.ragContextLength).toBeGreaterThanOrEqual(
      10
    )
    expect(assembly.remainingRagBudget).toBe(0)
    expect(result.promptContextStats.usedContextChunks).toEqual([
      expect.objectContaining({ id: "f", source: "file" }),
      expect.objectContaining({ id: "m", source: "memory" })
    ])
  })

  it("publishes immutable activity snapshots", () => {
    const onActivity = vi.fn()
    const assembly = new ContextAssembly(plan(), false, onActivity)
    const event = assembly.startActivity(
      "files",
      "searching_files",
      ACTIVITY_LABELS.searchingFiles
    )
    assembly.finishActivity(event, { resultCount: 2 })

    expect(onActivity).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining([expect.objectContaining({ status: "running" })])
    )
    expect(onActivity).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([
        expect.objectContaining({ status: "done", resultCount: 2 })
      ])
    )
  })

  it("adds the tab fallback and emits grounded stats", () => {
    const groundedPlan = createContextPlan({
      rawInput: "Question",
      maxRagContextChars: 100,
      groundedOnlyMode: true
    })
    const assembly = new ContextAssembly(groundedPlan, true)
    assembly.appendTabFallback("Page text", 100)

    const result = assembly.finish()
    expect(result.contentWithRAG).toContain("Page text")
    expect(result.promptContextStats.insufficientContext).toBe(false)
  })
})
