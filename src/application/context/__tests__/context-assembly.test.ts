import { ChatMessageMetricsSchema } from "@ollama-client/contracts/chat"
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
    const assembly = new ContextAssembly(plan(145), false)
    assembly.appendStoredContext(
      [{ id: "f", title: "File", content: "123456", score: 0.9 }],
      "query",
      () => "file"
    )
    assembly.appendStoredContext(
      [
        {
          id: "m",
          title: "Memory",
          content: "abcdef".repeat(20),
          score: 0.8,
          type: "memory"
        }
      ],
      "query",
      () => "memory"
    )

    const result = assembly.finish()
    expect(result.promptContextStats.ragContextLength).toBeLessThanOrEqual(145)
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
    const assembly = new ContextAssembly(plan(90), false)
    assembly.appendStoredContext(
      [{ id: 1, title: "One", content: "x".repeat(200), score: 1 }],
      "query",
      () => "file"
    )
    assembly.appendStoredContext(
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
    expect(result.promptContextStats.ragContextLength).toBeLessThanOrEqual(90)
  })

  it("uses leftover budget for an attachment whose long title exceeded its initial share", () => {
    const assembly = new ContextAssembly(plan(300), false)
    assembly.appendFileContext([
      { text: "A", metadata: { fileName: "a".repeat(96) + ".txt" } },
      { text: "B", metadata: { fileName: "b.txt" } }
    ])
    const result = assembly.finish()
    expect(
      result.ragSources?.sources.map((source) => source.content).sort()
    ).toEqual(["A", "B"])
    expect(result.promptContextStats.ragContextLength).toBeLessThanOrEqual(300)
  })

  it("keeps a long attached-file fallback within a tiny shared budget", () => {
    const assembly = new ContextAssembly(plan(20), false)
    assembly.appendFileContext([
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

  it("labels the exact accepted PDF passages even when their vector ids are equal", () => {
    const assembly = new ContextAssembly(plan(215), false)
    const first = {
      id: 0,
      type: "file",
      fileId: "first",
      title: "Report.pdf",
      page: 3,
      content: "First PDF evidence.",
      score: 1
    }
    const second = {
      ...first,
      fileId: "second",
      title: "Report (1).pdf",
      page: 7,
      content: "Second PDF evidence. " + "repeated text ".repeat(100)
    }
    const omitted = { ...second, page: 8, content: "OMITTED-PAGE" }

    assembly.appendStoredContext(
      [first, second, omitted],
      "query",
      () => "file"
    )
    const result = assembly.finish()

    expect(result.contentWithRAG).toContain(
      'id="doc-1" source="Report.pdf" page="3"'
    )
    expect(result.contentWithRAG).toContain(
      'id="doc-2" source="Report (1).pdf" page="7"'
    )
    expect(result.contentWithRAG).not.toContain('id="doc-3"')
    expect(result.contentWithRAG).not.toContain(omitted.content)
    const sources = result.ragSources?.sources ?? []
    expect(sources).toMatchObject([
      { id: 0, citationId: 1, page: 3, content: first.content },
      { id: 0, citationId: 2, page: 7, partial: true }
    ])
    const serializedMetrics = JSON.stringify({
      ragSources: sources,
      usedContextChunks: result.promptContextStats.usedContextChunks
    })
    const restored = ChatMessageMetricsSchema.parse(
      JSON.parse(serializedMetrics)
    )
    expect(
      restored.ragSources?.map(({ citationId, page, content }) => ({
        citationId,
        page,
        content
      }))
    ).toEqual([
      { citationId: 1, page: 3, content: first.content },
      { citationId: 2, page: 7, content: sources[1].content }
    ])
    expect(second.content.startsWith(sources[1].content)).toBe(true)
    expect(result.contentWithRAG).toContain(`\n${sources[1].content}\n</doc>`)
    expect(result.promptContextStats.usedContextChunks).toMatchObject([
      { citationId: 1, page: 3 },
      { citationId: 2, page: 7, partial: true }
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
