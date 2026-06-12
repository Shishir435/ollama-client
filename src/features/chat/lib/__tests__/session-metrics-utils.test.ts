import { describe, expect, it } from "vitest"
import type { ChatMessage } from "@/types"
import {
  calculateSessionMetrics,
  formatSessionDuration
} from "../session-metrics-utils"

const makeAssistantMsg = (
  overrides: Partial<ChatMessage> = {}
): ChatMessage => ({
  role: "assistant",
  content: "Hello",
  done: true,
  metrics: {
    total_duration: 1_000_000_000,
    load_duration: 100_000_000,
    prompt_eval_count: 10,
    prompt_eval_duration: 200_000_000,
    eval_count: 20,
    eval_duration: 500_000_000
  },
  ...overrides
})

describe("calculateSessionMetrics", () => {
  it("returns zeros for empty message list", () => {
    const result = calculateSessionMetrics([])
    expect(result.totalTokens).toBe(0)
    expect(result.totalDuration).toBe(0)
    expect(result.averageSpeed).toBe(0)
    expect(result.messageCount).toBe(0)
    expect(result.promptTokens).toBe(0)
    expect(result.generatedTokens).toBe(0)
  })

  it("skips system messages", () => {
    const msg: ChatMessage = { role: "system", content: "You are helpful." }
    const result = calculateSessionMetrics([msg])
    expect(result.messageCount).toBe(0)
  })

  it("skips user messages", () => {
    const msg: ChatMessage = { role: "user", content: "Hi", done: true }
    const result = calculateSessionMetrics([msg])
    expect(result.messageCount).toBe(0)
  })

  it("skips assistant messages without done=true", () => {
    const msg = makeAssistantMsg({ done: false })
    const result = calculateSessionMetrics([msg])
    expect(result.messageCount).toBe(0)
  })

  it("skips assistant messages without metrics", () => {
    const msg: ChatMessage = {
      role: "assistant",
      content: "Hi",
      done: true,
      metrics: undefined
    }
    const result = calculateSessionMetrics([msg])
    expect(result.messageCount).toBe(0)
  })

  it("counts single valid assistant message", () => {
    const result = calculateSessionMetrics([makeAssistantMsg()])
    expect(result.messageCount).toBe(1)
    expect(result.promptTokens).toBe(10)
    expect(result.generatedTokens).toBe(20)
    expect(result.totalTokens).toBe(30)
    expect(result.totalDuration).toBe(1_000_000_000)
  })

  it("sums metrics across multiple assistant messages", () => {
    const result = calculateSessionMetrics([
      makeAssistantMsg(),
      makeAssistantMsg()
    ])
    expect(result.messageCount).toBe(2)
    expect(result.promptTokens).toBe(20)
    expect(result.generatedTokens).toBe(40)
    expect(result.totalTokens).toBe(60)
    expect(result.totalDuration).toBe(2_000_000_000)
  })

  it("calculates averageSpeed as tokens/second from eval_duration", () => {
    // eval_count=20, eval_duration=500ms = 0.5s → 40 tok/s
    const result = calculateSessionMetrics([makeAssistantMsg()])
    expect(result.averageSpeed).toBeCloseTo(40, 1)
  })

  it("returns averageSpeed=0 when eval_duration is zero", () => {
    const msg = makeAssistantMsg({
      metrics: {
        ...(makeAssistantMsg().metrics ?? {}),
        eval_duration: 0
      }
    })
    const result = calculateSessionMetrics([msg])
    expect(result.averageSpeed).toBe(0)
  })

  it("returns averageSpeed=0 for tiny bogus eval_duration", () => {
    const msg = makeAssistantMsg({
      metrics: {
        ...(makeAssistantMsg().metrics ?? {}),
        eval_count: 100,
        eval_duration: 100_000
      }
    })
    const result = calculateSessionMetrics([msg])
    expect(result.averageSpeed).toBe(0)
  })
})

describe("formatSessionDuration", () => {
  it("formats sub-second durations as ms", () => {
    expect(formatSessionDuration(500_000_000)).toBe("500ms")
    expect(formatSessionDuration(100_000_000)).toBe("100ms")
  })

  it("formats seconds with one decimal", () => {
    expect(formatSessionDuration(1_500_000_000)).toBe("1.5s")
    expect(formatSessionDuration(30_000_000_000)).toBe("30.0s")
  })

  it("formats minutes with one decimal", () => {
    expect(formatSessionDuration(90_000_000_000)).toBe("1.5m")
    expect(formatSessionDuration(120_000_000_000)).toBe("2.0m")
  })

  it("formats exactly 1 second as 1.0s not ms", () => {
    expect(formatSessionDuration(1_000_000_000)).toBe("1.0s")
  })
})
