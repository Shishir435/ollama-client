import { describe, expect, it } from "vitest"
import { makeThinkingParserState, splitThinkingDelta } from "../thinking-parser"

describe("makeThinkingParserState", () => {
  it("initializes with inThinking=false and empty pending", () => {
    const state = makeThinkingParserState()
    expect(state.inThinking).toBe(false)
    expect(state.pending).toBe("")
  })
})

describe("splitThinkingDelta — plain text", () => {
  it("returns all text as visible when no tags", () => {
    const state = makeThinkingParserState()
    const result = splitThinkingDelta("Hello world", state)
    expect(result.visible).toBe("Hello world")
    expect(result.thinking).toBe("")
  })

  it("empty delta returns empty strings", () => {
    const state = makeThinkingParserState()
    const result = splitThinkingDelta("", state)
    expect(result.visible).toBe("")
    expect(result.thinking).toBe("")
  })
})

describe("splitThinkingDelta — think block", () => {
  it("routes <think> content to thinking output", () => {
    const state = makeThinkingParserState()
    const result = splitThinkingDelta(
      "<think>internal reasoning</think>final answer",
      state
    )
    expect(result.thinking).toBe("internal reasoning")
    expect(result.visible).toBe("final answer")
    expect(state.inThinking).toBe(false)
  })

  it("routes <thinking> tag variant", () => {
    const state = makeThinkingParserState()
    const result = splitThinkingDelta(
      "<thinking>deep thought</thinking>output",
      state
    )
    expect(result.thinking).toBe("deep thought")
    expect(result.visible).toBe("output")
  })

  it("routes <reasoning> tag variant", () => {
    const state = makeThinkingParserState()
    const result = splitThinkingDelta(
      "<reasoning>step by step</reasoning>answer",
      state
    )
    expect(result.thinking).toBe("step by step")
    expect(result.visible).toBe("answer")
  })

  it("captures text before think tag as visible", () => {
    const state = makeThinkingParserState()
    const result = splitThinkingDelta(
      "preamble <think>thought</think> epilogue",
      state
    )
    expect(result.visible).toBe("preamble  epilogue")
    expect(result.thinking).toBe("thought")
  })

  it("handles think block with no content after close tag", () => {
    const state = makeThinkingParserState()
    const result = splitThinkingDelta("<think>only thoughts</think>", state)
    expect(result.thinking).toBe("only thoughts")
    expect(result.visible).toBe("")
  })
})

describe("splitThinkingDelta — streaming / partial tags", () => {
  it("accumulates pending when chunk ends mid-open-tag", () => {
    const state = makeThinkingParserState()
    // Chunk ends with partial open tag
    const r1 = splitThinkingDelta("Some text <thi", state)
    expect(r1.visible).toBe("Some text ")
    expect(state.pending).toBe("<thi")

    // Next chunk completes the tag and provides content + close
    const r2 = splitThinkingDelta("nk>thought</think>done", state)
    expect(r2.thinking).toBe("thought")
    expect(r2.visible).toBe("done")
    expect(state.pending).toBe("")
    expect(state.inThinking).toBe(false)
  })

  it("stays inThinking across chunks when no close tag yet", () => {
    const state = makeThinkingParserState()
    splitThinkingDelta("<think>part one ", state)
    expect(state.inThinking).toBe(true)

    const r2 = splitThinkingDelta("part two</think>visible", state)
    expect(r2.thinking).toContain("part two")
    expect(r2.visible).toBe("visible")
    expect(state.inThinking).toBe(false)
  })

  it("accumulates pending when chunk ends mid-close-tag", () => {
    const state = makeThinkingParserState()
    splitThinkingDelta("<think>", state)
    expect(state.inThinking).toBe(true)

    const r1 = splitThinkingDelta("thinking content </thi", state)
    expect(r1.thinking).toBe("thinking content ")
    expect(state.pending).toBe("</thi")

    const r2 = splitThinkingDelta("nk>end", state)
    expect(r2.visible).toBe("end")
    expect(state.inThinking).toBe(false)
  })

  it("handles multiple think blocks in one delta", () => {
    const state = makeThinkingParserState()
    const result = splitThinkingDelta(
      "a<think>t1</think>b<think>t2</think>c",
      state
    )
    expect(result.visible).toBe("abc")
    expect(result.thinking).toBe("t1t2")
  })
})
