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
    const assembly = new ContextAssembly(plan(90), false)
    assembly.appendStoredContext(
      "123456",
      [{ id: "f", title: "File", content: "123456", score: 0.9 }],
      "query",
      () => "file"
    )
    assembly.appendStoredContext(
      "abcdef".repeat(20),
      [{ id: "m", title: "Memory", content: "abcdef".repeat(20), score: 0.8 }],
      "query",
      () => "memory"
    )

    const result = assembly.finish()
    expect(result.promptContextStats.ragContextLength).toBeLessThanOrEqual(90)
    expect(assembly.remainingRagBudget).toBe(0)
    expect(result.promptContextStats.usedContextChunks).toEqual([
      expect.objectContaining({ id: "f", source: "file" }),
      expect.objectContaining({ id: "m", source: "memory" })
    ])
    expect(result.ragSources?.sources[1].partial).toBe(true)
    expect(result.contentWithRAG).toContain(
      result.ragSources!.sources[1].content
    )
  })

  it("lists no source once the remaining budget is zero", () => {
    const assembly = new ContextAssembly(plan(60), false)
    assembly.appendStoredContext(
      "x".repeat(200),
      [{ id: 1, title: "One", content: "x".repeat(200), score: 1 }],
      "query",
      () => "file"
    )
    assembly.appendStoredContext(
      "UNSENT-CANARY",
      [{ id: 2, title: "Unsent", content: "UNSENT-CANARY", score: 1 }],
      "query",
      () => "file"
    )
    const result = assembly.finish()
    expect(result.ragSources?.sources.map((source) => source.id)).toEqual([1])
    expect(
      result.promptContextStats.usedContextChunks.map((source) => source.id)
    ).toEqual([1])
    expect(result.contentWithRAG).not.toContain("UNSENT-CANARY")
    expect(result.promptContextStats.ragContextLength).toBeLessThanOrEqual(60)
  })

  it("keeps a long attached-file fallback within a tiny shared budget", () => {
    const assembly = new ContextAssembly(plan(20), false)
    assembly.appendFileFallback([
      {
        text: "file ".repeat(1000),
        metadata: { fileId: "file", fileName: "long.txt" }
      }
    ])
    const result = assembly.finish()
    expect(
      result.contentWithRAG.length - "Question".length
    ).toBeLessThanOrEqual(20)
    expect(result.promptContextStats.ragContextLength).toBeLessThanOrEqual(20)
    expect(result.ragSources?.sources.length ?? 0).toBe(0)
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
