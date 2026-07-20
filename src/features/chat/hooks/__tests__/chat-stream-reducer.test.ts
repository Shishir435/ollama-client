import { describe, expect, it } from "vitest"

import type { ChatMessage } from "@/types"
import {
  makeStreamReducerState,
  reduceStreamEvent,
  type StreamMessage,
  type StreamReducerState
} from "../chat-stream-reducer"

const shell = (): ChatMessage => ({
  role: "assistant",
  content: "",
  model: "m"
})

const start = (): StreamReducerState => makeStreamReducerState(shell())

const apply = (
  state: StreamReducerState,
  msgs: StreamMessage[]
): {
  state: StreamReducerState
  last: ReturnType<typeof reduceStreamEvent>
} => {
  let s = state
  let last = reduceStreamEvent(s, msgs[0])
  s = last.state
  for (const m of msgs.slice(1)) {
    last = reduceStreamEvent(s, m)
    s = last.state
  }
  return { state: s, last }
}

describe("reduceStreamEvent", () => {
  it("accumulates visible deltas and emits tokens", () => {
    const r1 = reduceStreamEvent(start(), { delta: "Hel" })
    expect(r1.tokens).toEqual(["Hel"])
    expect(r1.changed).toBe(true)
    expect(r1.justStarted).toBe(true)
    expect(r1.state.assistant.content).toBe("Hel")

    const r2 = reduceStreamEvent(r1.state, { delta: "lo" })
    expect(r2.tokens).toEqual(["lo"])
    expect(r2.justStarted).toBe(false)
    expect(r2.state.assistant.content).toBe("Hello")
  })

  it("drops duplicate/out-of-order sequenced chunks", () => {
    const r1 = reduceStreamEvent(start(), { seq: 0, delta: "a" })
    const r2 = reduceStreamEvent(r1.state, { seq: 1, delta: "b" })
    expect(r2.state.assistant.content).toBe("ab")

    const dup = reduceStreamEvent(r2.state, { seq: 1, delta: "b" })
    expect(dup.dropped).toBe(true)
    expect(dup.state.assistant.content).toBe("ab")

    const stale = reduceStreamEvent(r2.state, { seq: 0, delta: "x" })
    expect(stale.dropped).toBe(true)
  })

  it("folds rag_sources into metrics without a visible change or token", () => {
    const r = reduceStreamEvent(start(), {
      type: "rag_sources",
      payload: {
        query: "q",
        sources: [{ id: 1, title: "t", content: "c", score: 0.9 }]
      }
    })
    expect(r.changed).toBe(false)
    expect(r.tokens).toEqual([])
    expect(r.justStarted).toBe(true)
    expect(r.state.assistant.metrics?.ragQuery).toBe("q")
    expect(r.state.assistant.metrics?.ragSources).toHaveLength(1)
  })

  it("splits inline <think> tags across chunk boundaries into thinking", () => {
    // The open tag is split across two deltas; the parser state must carry the
    // pending prefix so nothing leaks into visible content.
    const { state, last } = apply(start(), [
      { delta: "<thin" },
      { delta: "k>secret</think>answer" }
    ])
    expect(state.assistant.thinking).toBe("secret")
    expect(state.assistant.content).toBe("answer")
    expect(last.tokens).toEqual(["answer"])
  })

  it("appends explicit thinkingDelta and reasoning fields", () => {
    const r1 = reduceStreamEvent(start(), { thinkingDelta: "step " })
    const r2 = reduceStreamEvent(r1.state, {
      message: { reasoning: "more" }
    })
    expect(r2.state.assistant.thinking).toBe("step more")
    expect(r2.state.assistant.content).toBe("")
  })

  it("replaces the tool-run snapshot and stores the replay artifact", () => {
    const artifact = {
      version: 1 as const,
      wire: "anthropic" as const,
      providerId: "anthropic",
      model: "m",
      blocks: [{ type: "thinking" }]
    }
    const r = reduceStreamEvent(start(), {
      toolRuns: [
        {
          toolId: "web_search",
          label: "Search",
          status: "running",
          startedAt: 1
        }
      ],
      replayArtifact: artifact
    })
    expect(r.changed).toBe(true)
    expect(r.state.assistant.metrics?.toolRuns).toHaveLength(1)
    expect(r.state.assistant.replayArtifact).toBe(artifact)
  })

  it("finalizes a successful stream, merging terminal metrics", () => {
    const { state, last } = apply(start(), [
      { delta: "done" },
      { done: true, metrics: { eval_count: 5 } }
    ])
    expect(last.terminal?.type).toBe("success")
    if (last.terminal?.type === "success") {
      expect(last.terminal.message.content).toBe("done")
      expect(last.terminal.message.done).toBe(true)
      expect(last.terminal.message.metrics?.eval_count).toBe(5)
    }
    expect(state.assistant.done).toBe(true)
  })

  it("promotes thinking to content when a tool-backed turn has no visible answer", () => {
    const { last } = apply(start(), [
      {
        toolRuns: [
          {
            toolId: "web_search",
            label: "Search",
            status: "done",
            startedAt: 1
          }
        ]
      },
      { thinkingDelta: "reasoned result" },
      { done: true }
    ])
    if (last.terminal?.type === "success") {
      expect(last.terminal.message.content).toBe("reasoned result")
      expect(last.terminal.message.metrics?.thinkingOnlyResponse).toBe(true)
    } else {
      throw new Error("expected success terminal")
    }
  })

  it("uses the fallback answer when a turn ends with neither content nor tools", () => {
    const { last } = apply(start(), [
      { thinkingDelta: "just musing" },
      { done: true }
    ])
    if (last.terminal?.type === "success") {
      expect(last.terminal.message.content).toContain("did not receive")
      expect(last.terminal.message.metrics?.thinkingOnlyResponse).toBe(true)
    } else {
      throw new Error("expected success terminal")
    }
  })

  it("surfaces a terminal error with the accumulated partial for display", () => {
    const { last } = apply(start(), [
      { delta: "partial" },
      { error: { status: 500, message: "boom", kind: "provider" } }
    ])
    expect(last.terminal?.type).toBe("error")
    if (last.terminal?.type === "error") {
      expect(last.terminal.error.status).toBe(500)
      expect(last.terminal.partial.content).toBe("partial")
    }
    expect(last.state.assistant.done).toBe(true)
  })

  it("does not mutate the input state's thinking parser", () => {
    const s0 = start()
    reduceStreamEvent(s0, { delta: "<think>hidden" })
    // The original state's parser must be untouched (still not in-thinking).
    expect(s0.thinkingState.inThinking).toBe(false)
    expect(s0.thinkingState.pending).toBe("")
  })
})
