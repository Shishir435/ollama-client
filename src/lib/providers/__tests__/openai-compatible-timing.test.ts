import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OpenAICompatibleProvider } from "@/lib/providers/openai-compatible"
import type { ChatStreamMessage } from "@/types"
import { ProviderType } from "../types"

let clock = 0

/**
 * An SSE body whose chunks arrive `gapMs` apart on the mocked clock. No
 * read-ahead, so the clock moves only when the reader asks for a chunk.
 */
const timedStream = (chunks: Array<{ gapMs: number; data: string }>) => {
  const encoder = new TextEncoder()
  let index = 0
  return new Response(
    new ReadableStream(
      {
        pull(controller) {
          const next = chunks[index++]
          if (!next) {
            controller.close()
            return
          }
          clock += next.gapMs
          controller.enqueue(encoder.encode(next.data))
        }
      },
      { highWaterMark: 0 }
    )
  )
}

const sse = (body: unknown) => `data: ${JSON.stringify(body)}\n\n`
const delta = (content: string) =>
  sse({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })
const reasoningDelta = (reasoning_content: string) =>
  sse({
    choices: [{ index: 0, delta: { reasoning_content }, finish_reason: null }]
  })
const finish = (completionTokens: number, reasoningTokens?: number) =>
  sse({
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: {
      prompt_tokens: 10,
      completion_tokens: completionTokens,
      total_tokens: 10 + completionTokens,
      ...(reasoningTokens !== undefined
        ? { completion_tokens_details: { reasoning_tokens: reasoningTokens } }
        : {})
    }
  })
const speed = (metrics: ChatStreamMessage["metrics"]) =>
  metrics?.eval_count && metrics.eval_duration
    ? metrics.eval_count / (metrics.eval_duration / 1e9)
    : undefined

const provider = () =>
  new OpenAICompatibleProvider({
    id: "custom:openai:olc",
    name: "olc",
    type: ProviderType.OPENAI,
    enabled: true,
    baseUrl: "http://olc.test/v1"
  })

const finalMetrics = async (
  respond: () => Response,
  headerDelayMs: number
): Promise<ChatStreamMessage["metrics"]> => {
  vi.mocked(fetch).mockImplementationOnce(async () => {
    clock += headerDelayMs
    return respond()
  })
  const chunks: ChatStreamMessage[] = []
  await provider().streamChat(
    { model: "codex/gpt-6-luna", messages: [{ role: "user", content: "hi" }] },
    (chunk) => chunks.push(chunk)
  )
  return chunks.find((chunk) => chunk.done)?.metrics
}

describe("OpenAI-compatible stream timings", () => {
  beforeEach(() => {
    clock = 1_000_000
    vi.spyOn(Date, "now").mockImplementation(() => clock)
    global.fetch = vi.fn()
  })
  afterEach(() => vi.restoreAllMocks())

  it("counts the wait before the response headers in the total", async () => {
    /** A proxy that holds its headers until the answer is ready. */
    const metrics = await finalMetrics(
      () =>
        timedStream([
          { gapMs: 0, data: delta("42") },
          { gapMs: 0, data: finish(5) },
          { gapMs: 0, data: "data: [DONE]\n\n" }
        ]),
      4_000
    )

    expect(metrics?.total_duration).toBe(4_000 * 1_000_000)
  })

  it("reports no speed for output that arrived in one burst", async () => {
    const metrics = await finalMetrics(
      () =>
        timedStream([
          { gapMs: 0, data: delta("42") },
          { gapMs: 2, data: finish(500) },
          { gapMs: 0, data: "data: [DONE]\n\n" }
        ]),
      0
    )

    expect(metrics?.eval_count).toBe(500)
    expect(metrics?.eval_duration).toBeUndefined()
  })

  it("reports no speed when no text arrived at all", async () => {
    const metrics = await finalMetrics(
      () =>
        timedStream([
          { gapMs: 300, data: finish(12) },
          { gapMs: 0, data: "data: [DONE]\n\n" }
        ]),
      0
    )

    expect(metrics?.eval_duration).toBeUndefined()
  })

  it("measures speed over a stream it watched", async () => {
    const metrics = await finalMetrics(
      () =>
        timedStream([
          { gapMs: 0, data: delta("one ") },
          { gapMs: 400, data: delta("two ") },
          { gapMs: 600, data: finish(20) },
          { gapMs: 0, data: "data: [DONE]\n\n" }
        ]),
      250
    )

    expect(metrics?.eval_duration).toBe(1_000 * 1_000_000)
    expect(metrics?.prompt_eval_duration).toBe(250 * 1_000_000)
  })

  it("rates only the visible tokens when reasoning was counted but not streamed", async () => {
    /** Codex through olc: 38 hidden reasoning tokens, 208 visible in 1s. */
    const metrics = await finalMetrics(
      () =>
        timedStream([
          { gapMs: 0, data: delta("a ") },
          { gapMs: 1_000, data: finish(246, 38) },
          { gapMs: 0, data: "data: [DONE]\n\n" }
        ]),
      4_000
    )

    expect(metrics?.eval_count).toBe(246)
    expect(speed(metrics)).toBeCloseTo(208, 5)
  })

  it("times streamed reasoning as part of the generation window", async () => {
    const metrics = await finalMetrics(
      () =>
        timedStream([
          { gapMs: 0, data: reasoningDelta("thinking") },
          { gapMs: 500, data: delta("answer") },
          { gapMs: 500, data: finish(100, 40) },
          { gapMs: 0, data: "data: [DONE]\n\n" }
        ]),
      200
    )

    expect(metrics?.prompt_eval_duration).toBe(200 * 1_000_000)
    expect(metrics?.eval_duration).toBe(1_000 * 1_000_000)
    expect(speed(metrics)).toBeCloseTo(100, 5)
  })
})
