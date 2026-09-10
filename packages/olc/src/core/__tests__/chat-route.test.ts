import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type {
  AgentBackend,
  BackendContext,
  BackendTurn,
  CatalogModel,
  TurnResult,
  TurnRunSignals,
  TurnStreamHandlers
} from "../../backends/types.js"
import { resolveConfig } from "../../config.js"
import type {
  ProxyConfig,
  ReasoningEffort,
  ToolResultMessage
} from "../../types.js"
import { registerChatRoutes } from "../chat-route.js"
import { createClientToolInvoker } from "../client-tools.js"
import { createRouter, sendJson } from "../http.js"
import { PendingToolCalls } from "../pending-tool-calls.js"
import { createRequestQueue } from "../queue.js"

/**
 * A backend that exists only to exercise the core.
 *
 * It is the whole point of the backend port: the OpenAI wire format, the parked-call
 * registry and the suspend/resume handshake are testable without OpenCode, and a new
 * runtime can be checked against the same expectations.
 */
interface FakeBackendOptions {
  mode: "answer" | "tool" | "fail" | "image"
  answer?: string
  /** Holds `ensureReady` so a caller can leave while the backend is starting. */
  readyDelayMs?: number
}

/** A prompt that makes the fake backend hold the queue for a while. */
const SLOW_TURN_MARKER = "please-be-slow"
const SLOW_TURN_MS = 300

const MODEL: CatalogModel = {
  id: "fake/model-a",
  object: "model",
  created: 0,
  owned_by: "fake",
  name: "Model A",
  input_modalities: ["text"],
  supported_parameters: ["tools"],
  capabilities: { function_calling: true, vision: false, reasoning: false }
}

const createFakeBackend = (
  context: BackendContext,
  options: FakeBackendOptions
) => {
  const turns = new Map<string, FakeTurn>()
  const calls: {
    startTurn: number
    dispose: number
    abort: number
    ensureReady: number
    reasoningEfforts: Array<ReasoningEffort | undefined>
    startedMessages: unknown[][]
  } = {
    startTurn: 0,
    dispose: 0,
    abort: 0,
    ensureReady: 0,
    reasoningEfforts: [],
    startedMessages: [] as unknown[][]
  }
  let nextId = 0

  class FakeTurn implements BackendTurn {
    readonly id: string
    readonly slow: boolean
    private toolPromise: Promise<string> | null = null
    private toolOutput = ""
    private streamed = ""

    constructor(id: string, slow = false) {
      this.id = id
      this.slow = slow
    }

    async run(
      handlers: TurnStreamHandlers,
      signals: TurnRunSignals
    ): Promise<TurnResult> {
      if (this.slow) {
        await new Promise((resolve) => setTimeout(resolve, SLOW_TURN_MS))
        this.emit(handlers, "took a while")
        return {
          status: "completed",
          content: this.streamed,
          reasoning: "",
          finish: "stop"
        }
      }

      if (options.mode === "fail") {
        return {
          status: "failed",
          error: { message: "upstream exploded", type: "FakeError" }
        }
      }

      if (options.mode === "image") {
        const image = { b64Json: "AAAA", revisedPrompt: "A red square" }
        handlers.onImage?.(image)
        return {
          status: "completed",
          content: "",
          reasoning: "",
          images: [image],
          finish: "stop"
        }
      }

      this.emit(handlers, "working. ")

      if (options.mode === "answer") {
        return {
          status: "completed",
          content: `${this.streamed}${options.answer ?? "done"}`,
          reasoning: "",
          finish: "stop"
        }
      }

      if (!this.toolPromise) {
        this.toolPromise = context.callClientTool({
          turnId: this.id,
          tool: "list_tabs",
          args: { limit: 2 }
        })
        this.toolPromise.then(
          (output) => {
            this.toolOutput = output
          },
          () => {
            this.toolOutput = ""
          }
        )
      }

      const settled = await Promise.race([
        signals.suspended.then(() => "suspended" as const),
        this.toolPromise
          .then(() => "released" as const)
          .catch(() => "released" as const)
      ])
      if (settled === "suspended") return { status: "suspended" }
      return this.answerFromTool(handlers)
    }

    async resume(
      results: ToolResultMessage[],
      handlers: TurnStreamHandlers,
      signals: TurnRunSignals
    ): Promise<TurnResult> {
      expect(results.length).toBeGreaterThan(0)
      signals.releaseToolResults?.()
      await this.toolPromise
      return this.answerFromTool(handlers)
    }

    async abort(): Promise<void> {
      calls.abort += 1
    }

    async dispose(): Promise<void> {
      calls.dispose += 1
      turns.delete(this.id)
    }

    private answerFromTool(handlers: TurnStreamHandlers): TurnResult {
      this.emit(handlers, `saw ${this.toolOutput}`)
      return {
        status: "completed",
        content: this.streamed,
        reasoning: "",
        finish: "stop"
      }
    }

    private emit(handlers: TurnStreamHandlers, text: string) {
      this.streamed += text
      handlers.onText(text)
    }
  }

  const backend: AgentBackend = {
    id: "fake",
    ensureReady: async () => {
      calls.ensureReady += 1
      if (options.readyDelayMs)
        await new Promise((resolve) =>
          setTimeout(resolve, options.readyDelayMs)
        )
    },
    listModels: async () => [MODEL],
    resolveModel: async (requested) =>
      requested === "fake/model-a"
        ? { providerId: "fake", modelId: "model-a" }
        : { error: `Model '${String(requested)}' is not in the catalog.` },
    startTurn: async (input) => {
      calls.startTurn += 1
      calls.reasoningEfforts.push(input.reasoningEffort)
      calls.startedMessages.push(input.messages as unknown[])
      nextId += 1
      const turn = new FakeTurn(
        `turn_${nextId}`,
        JSON.stringify(input.messages).includes(SLOW_TURN_MARKER)
      )
      turns.set(turn.id, turn)
      return turn
    },
    findTurn: (turnId) => turns.get(turnId),
    shutdown: async () => {}
  }

  return { backend, calls }
}

interface Harness {
  url: string
  server: Server
  routes: ReturnType<typeof registerChatRoutes>
  calls: {
    startTurn: number
    dispose: number
    abort: number
    ensureReady: number
    reasoningEfforts: Array<ReasoningEffort | undefined>
    /** The messages each turn was started with, in order. */
    startedMessages: unknown[][]
  }
  pending: PendingToolCalls
}

const startHarness = async (
  options: FakeBackendOptions,
  configOverrides: Partial<ProxyConfig> = {}
): Promise<Harness> => {
  const config: ProxyConfig = {
    ...resolveConfig({ BRIDGE_BATCH_MS: 0 }),
    ...configOverrides
  }
  const pending = new PendingToolCalls({
    timeoutMs: config.BRIDGE_CALL_TIMEOUT_MS
  })
  const context = {
    config,
    options: {},
    fileOptions: {},
    log: () => {},
    retryAsync: <T>(operation: () => Promise<T>) => operation(),
    callClientTool: createClientToolInvoker({ pending })
  } satisfies BackendContext
  const { backend, calls } = createFakeBackend(context, options)

  const router = createRouter({
    authorize: (request) =>
      !config.API_KEY ||
      request.path === "/health" ||
      request.headers.authorization === `Bearer ${config.API_KEY}`
  })
  router.get("/health", (_request, response) =>
    sendJson(response, 200, { status: "ok" })
  )
  const routes = registerChatRoutes(router, {
    backend,
    config,
    log: () => {},
    pending,
    lock: createRequestQueue()
  })

  const server = createServer((request, response) => {
    void router.handle(request, response)
  })
  server.requestTimeout = 0
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo

  return { url: `http://127.0.0.1:${port}`, server, calls, pending, routes }
}

interface StreamedTurn {
  status: number
  content: string
  finishReason: string | null
  toolCalls: {
    id: string
    function: { name: string; arguments: string }
  }[]
  images: string[]
  error?: { message: string; type: string; status: number }
}

const streamTurn = async (
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<StreamedTurn> => {
  const response = await fetch(`${url}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  })
  if (!response.ok || !response.body) {
    return {
      status: response.status,
      content: await response.text(),
      finishReason: null,
      toolCalls: [],
      images: []
    }
  }

  const text = await response.text()
  const result: StreamedTurn = {
    status: response.status,
    content: "",
    finishReason: null,
    toolCalls: [],
    images: []
  }
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue
    const payload = line.slice(6).trim()
    if (payload === "[DONE]") continue
    const frame = JSON.parse(payload)
    if (frame.error) {
      result.error = frame.error
      continue
    }
    const choice = frame.choices?.[0]
    if (typeof choice?.delta?.content === "string") {
      result.content += choice.delta.content
    }
    if (Array.isArray(choice?.delta?.content)) {
      for (const part of choice.delta.content) {
        if (typeof part?.b64_json === "string") {
          result.images.push(part.b64_json)
        }
      }
    }
    if (Array.isArray(choice?.delta?.tool_calls)) {
      result.toolCalls.push(...choice.delta.tool_calls)
    }
    if (choice?.finish_reason) result.finishReason = choice.finish_reason
  }
  return result
}

let harness: Harness | null = null

beforeEach(() => {
  harness = null
})

afterEach(async () => {
  if (harness) {
    await new Promise<void>((resolve) => harness?.server.close(() => resolve()))
    harness = null
  }
})

const askedForTabs = [
  { role: "system", content: "be helpful" },
  { role: "user", content: "which tabs are open?" }
]

describe("chat completions", () => {
  it("streams a plain answer and stops", async () => {
    harness = await startHarness({ mode: "answer", answer: "all good" })
    const turn = await streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      messages: askedForTabs
    })

    expect(turn.content).toBe("working. all good")
    expect(turn.finishReason).toBe("stop")
    expect(harness.calls.dispose).toBe(1)
  })

  it("streams generated image parts without inventing fallback text", async () => {
    harness = await startHarness({ mode: "image" })
    const turn = await streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      messages: askedForTabs
    })

    expect(turn.content).toBe("")
    expect(turn.images).toEqual(["AAAA"])
    expect(turn.finishReason).toBe("stop")
  })

  it("normalizes flat and nested reasoning effort for the backend", async () => {
    harness = await startHarness({ mode: "answer" })

    await streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      reasoning_effort: "high",
      messages: askedForTabs
    })
    await streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      reasoning: { effort: "low" },
      messages: askedForTabs
    })

    expect(harness.calls.reasoningEfforts).toEqual(["high", "low"])
  })

  it("rejects invalid or conflicting reasoning effort before starting a turn", async () => {
    harness = await startHarness({ mode: "answer" })

    const invalid = await streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      reasoning_effort: "ultra",
      messages: askedForTabs
    })
    const conflicting = await streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      reasoning_effort: "high",
      reasoning: { effort: "low" },
      messages: askedForTabs
    })

    expect(invalid.status).toBe(400)
    expect(conflicting.status).toBe(400)
    expect(harness.calls.startTurn).toBe(0)
  })

  it("hands a parked tool call to the client, then resumes the same turn", async () => {
    harness = await startHarness({ mode: "tool" })

    const first = await streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      messages: askedForTabs,
      tools: [{ type: "function", function: { name: "list_tabs" } }]
    })

    expect(first.finishReason).toBe("tool_calls")
    expect(first.content).toBe("working. ")
    expect(first.toolCalls).toHaveLength(1)
    expect(first.toolCalls[0]?.function).toEqual({
      name: "list_tabs",
      arguments: '{"limit":2}'
    })
    expect(harness.calls.dispose).toBe(0)

    const call = first.toolCalls[0]
    const second = await streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      messages: [
        ...askedForTabs,
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: call?.id, type: "function", function: call?.function }
          ]
        },
        { role: "tool", tool_call_id: call?.id, content: "two tabs" }
      ],
      tools: [{ type: "function", function: { name: "list_tabs" } }]
    })

    expect(second.finishReason).toBe("stop")
    expect(second.content).toContain("saw two tabs")
    // The resumed request must continue the parked turn, not start a second one.
    expect(harness.calls.startTurn).toBe(1)
    expect(harness.calls.dispose).toBe(1)
  })

  it("returns tool calls in the non-streaming envelope too", async () => {
    harness = await startHarness({ mode: "tool" })
    const response = await fetch(`${harness.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fake/model-a",
        stream: false,
        messages: askedForTabs,
        tools: [{ type: "function", function: { name: "list_tabs" } }]
      })
    })
    const body = (await response.json()) as {
      choices: {
        finish_reason: string
        message: { tool_calls: { function: { name: string } }[] }
      }[]
    }

    expect(response.status).toBe(200)
    expect(body.choices[0].finish_reason).toBe("tool_calls")
    expect(body.choices[0].message.tool_calls[0].function.name).toBe(
      "list_tabs"
    )
  })

  it("reports a backend failure as an error event, not as an answer", async () => {
    harness = await startHarness({ mode: "fail" })
    const turn = await streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      messages: askedForTabs
    })

    // A failure finished with `stop` reads as a completed turn to every
    // OpenAI-compatible client, which is how a provider error became a
    // decision with no tool call.
    expect(turn.error).toEqual({
      message: "upstream exploded",
      type: "FakeError",
      status: 502
    })
    expect(turn.content).toBe("")
    expect(turn.finishReason).toBeNull()
    expect(harness.calls.dispose).toBe(1)
  })

  it("reports a backend failure in the non-streaming envelope too", async () => {
    harness = await startHarness({ mode: "fail" })
    const response = await fetch(`${harness.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fake/model-a",
        stream: false,
        messages: askedForTabs
      })
    })

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      error: { message: "upstream exploded", type: "FakeError" }
    })
    expect(harness.calls.dispose).toBe(1)
  })

  it("never starts a request whose client left while it was queued", async () => {
    harness = await startHarness({ mode: "answer" })
    const holding = streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      messages: [{ role: "user", content: SLOW_TURN_MARKER }]
    })
    const abandoned = new AbortController()
    const queued = fetch(`${harness.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fake/model-a",
        stream: true,
        messages: askedForTabs
      }),
      signal: abandoned.signal
    }).catch(() => undefined)

    await new Promise((resolve) => setTimeout(resolve, 30))
    abandoned.abort()
    await queued
    await holding
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(harness.calls.startTurn).toBe(1)
  })

  it("unwinds a cancelled stream before admitting the next request", async () => {
    harness = await startHarness({ mode: "answer" })
    const leaving = new AbortController()
    const cancelled = fetch(`${harness.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fake/model-a",
        stream: true,
        messages: [{ role: "user", content: SLOW_TURN_MARKER }]
      }),
      signal: leaving.signal
    }).catch(() => undefined)

    await new Promise((resolve) => setTimeout(resolve, 30))
    leaving.abort()
    await cancelled

    const next = await streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      messages: askedForTabs
    })

    expect(next.content).toBe("working. done")
    expect(harness.calls.abort).toBe(1)
    expect(harness.calls.startTurn).toBe(2)
  })

  it("does not spend a turn when the client leaves during backend startup", async () => {
    harness = await startHarness({ mode: "answer", readyDelayMs: 150 })
    const leaving = new AbortController()
    const cancelled = fetch(`${harness.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fake/model-a",
        stream: true,
        messages: askedForTabs
      }),
      signal: leaving.signal
    }).catch(() => undefined)

    await new Promise((resolve) => setTimeout(resolve, 40))
    leaving.abort()
    await cancelled
    await new Promise((resolve) => setTimeout(resolve, 250))

    // Startup itself is shared and is not cancelled; the turn behind it is.
    expect(harness.calls.ensureReady).toBe(1)
    expect(harness.calls.startTurn).toBe(0)
  })

  it("rejects an unknown model and an empty conversation", async () => {
    harness = await startHarness({ mode: "answer" })

    const unknownModel = await streamTurn(harness.url, {
      model: "nope",
      stream: true,
      messages: askedForTabs
    })
    expect(unknownModel.status).toBe(400)

    const noMessages = await streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      messages: []
    })
    expect(noMessages.status).toBe(400)
    expect(harness.calls.startTurn).toBe(0)
  })

  it("rejects results for two live turns without releasing either", async () => {
    harness = await startHarness({ mode: "tool" })
    const askForTools = (messages: unknown[]) =>
      streamTurn(harness?.url as string, {
        model: "fake/model-a",
        stream: true,
        messages,
        tools: [{ type: "function", function: { name: "list_tabs" } }]
      })

    const firstTurn = await askForTools(askedForTabs)
    const secondTurn = await askForTools([
      { role: "user", content: "and now?" }
    ])
    const firstCall = firstTurn.toolCalls[0]
    const secondCall = secondTurn.toolCalls[0]
    expect(firstCall?.id).toBeDefined()
    expect(secondCall?.id).toBeDefined()
    expect(harness.calls.startTurn).toBe(2)

    const mixed = await askForTools([
      ...askedForTabs,
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: firstCall?.id, type: "function", function: firstCall?.function }
        ]
      },
      { role: "tool", tool_call_id: firstCall?.id, content: "tabs for one" },
      { role: "tool", tool_call_id: secondCall?.id, content: "tabs for two" }
    ])

    expect(mixed.status).toBe(400)
    expect(mixed.content).toContain("MixedToolResults")
    expect(mixed.content).toContain("No tool results were accepted")
    expect(harness.calls.startTurn).toBe(2)
    expect(harness.pending.turnOf(firstCall?.id as string)).toBeDefined()
    expect(harness.pending.turnOf(secondCall?.id as string)).toBeDefined()
  })

  it("rejects a live and stale result atomically so the live result can retry", async () => {
    harness = await startHarness({ mode: "tool" })
    const askForTools = (messages: unknown[]) =>
      streamTurn(harness?.url as string, {
        model: "fake/model-a",
        stream: true,
        messages,
        tools: [{ type: "function", function: { name: "list_tabs" } }]
      })
    const first = await askForTools(askedForTabs)
    const call = first.toolCalls[0]
    expect(call?.id).toBeDefined()

    const transcript = [
      ...askedForTabs,
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: call?.id, type: "function", function: call?.function }
        ]
      }
    ]
    const mixed = await askForTools([
      ...transcript,
      { role: "tool", tool_call_id: call?.id, content: "two tabs" },
      { role: "tool", tool_call_id: "call_expired", content: "too late" }
    ])

    expect(mixed.status).toBe(400)
    expect(mixed.content).toContain("MixedToolResults")
    expect(mixed.content).toContain("call_expired")
    expect(harness.pending.turnOf(call?.id as string)).toBeDefined()

    const retried = await askForTools([
      ...transcript,
      { role: "tool", tool_call_id: call?.id, content: "two tabs" }
    ])
    expect(retried.status).toBe(200)
    expect(retried.content).toContain("saw two tabs")
    expect(harness.calls.startTurn).toBe(1)
  })

  it("refuses a tool result no live turn is waiting for", async () => {
    harness = await startHarness({ mode: "answer" })
    const response = await fetch(`${harness.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fake/model-a",
        stream: true,
        messages: [
          ...askedForTabs,
          { role: "tool", tool_call_id: "call_gone", content: "two tabs" }
        ]
      })
    })
    const body = (await response.json()) as {
      error: { message: string; type: string }
    }

    expect(response.status).toBe(400)
    expect(body.error.type).toBe("StaleToolResults")
    expect(body.error.message).toContain("call_gone")
    // The result must not be laundered into a fresh turn the model would answer
    // as if the tool had never run.
    expect(harness.calls.startTurn).toBe(0)
  })

  it("refuses a tool result once its parked turn has expired", async () => {
    harness = await startHarness(
      { mode: "tool" },
      { SUSPENDED_TURN_TTL_MS: 20 }
    )
    const first = await streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      messages: askedForTabs,
      tools: [{ type: "function", function: { name: "list_tabs" } }]
    })
    const call = first.toolCalls[0]
    expect(call?.id).toBeDefined()

    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(harness.pending.turnOf(call?.id as string)).toBeUndefined()

    const late = await streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      messages: [
        ...askedForTabs,
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: call?.id, type: "function", function: call?.function }
          ]
        },
        { role: "tool", tool_call_id: call?.id, content: "two tabs" }
      ],
      tools: [{ type: "function", function: { name: "list_tabs" } }]
    })

    expect(late.status).toBe(400)
    expect(late.content).toContain("StaleToolResults")
    expect(harness.calls.startTurn).toBe(1)
  })

  it("keeps a parked turn alive while its own resume waits in the queue", async () => {
    harness = await startHarness(
      { mode: "tool" },
      { SUSPENDED_TURN_TTL_MS: 100 }
    )
    const first = await streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      messages: askedForTabs,
      tools: [{ type: "function", function: { name: "list_tabs" } }]
    })
    const call = first.toolCalls[0]
    expect(call?.id).toBeDefined()

    // Occupy the single-flight slot for longer than the parked turn's deadline, so
    // the resume behind it can only succeed if arriving cancelled that deadline.
    const slow = streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      messages: [{ role: "user", content: SLOW_TURN_MARKER }]
    })
    await new Promise((resolve) => setTimeout(resolve, 30))

    const resumed = await streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      messages: [
        ...askedForTabs,
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: call?.id, type: "function", function: call?.function }
          ]
        },
        { role: "tool", tool_call_id: call?.id, content: "two tabs" }
      ],
      tools: [{ type: "function", function: { name: "list_tabs" } }]
    })
    await slow

    expect(resumed.status).toBe(200)
    expect(resumed.finishReason).toBe("stop")
    expect(resumed.content).toContain("saw two tabs")
  })

  it("keeps a parked call alive while its own resume waits in the queue", async () => {
    // The call's deadline is shorter than the turn's, and shorter than the turn
    // ahead of it in the queue — which is the ordering that loses a result the
    // client already produced.
    harness = await startHarness(
      { mode: "tool" },
      { BRIDGE_CALL_TIMEOUT_MS: 80, SUSPENDED_TURN_TTL_MS: 100 }
    )
    const first = await streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      messages: askedForTabs,
      tools: [{ type: "function", function: { name: "list_tabs" } }]
    })
    const call = first.toolCalls[0]
    expect(call?.id).toBeDefined()

    const slow = streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      messages: [{ role: "user", content: SLOW_TURN_MARKER }]
    })
    await new Promise((resolve) => setTimeout(resolve, 30))

    const resumed = await streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      messages: [
        ...askedForTabs,
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: call?.id, type: "function", function: call?.function }
          ]
        },
        { role: "tool", tool_call_id: call?.id, content: "two tabs" }
      ],
      tools: [{ type: "function", function: { name: "list_tabs" } }]
    })
    await slow

    expect(resumed.status).toBe(200)
    expect(resumed.finishReason).toBe("stop")
    expect(resumed.content).toContain("saw two tabs")
  })

  it("requires the configured bearer token", async () => {
    harness = await startHarness({ mode: "answer" }, { API_KEY: "secret" })

    const rejected = await streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      messages: askedForTabs
    })
    expect(rejected.status).toBe(401)

    const accepted = await streamTurn(
      harness.url,
      { model: "fake/model-a", stream: true, messages: askedForTabs },
      { Authorization: "Bearer secret" }
    )
    expect(accepted.finishReason).toBe("stop")
  })
})

/**
 * A browser-agent run, as the proxy sees it.
 *
 * Every step is one request that declares a decision tool, gets the call back
 * as a `tool_calls` delta, and never returns a result: the extension parses
 * the decision and starts the next step as a fresh conversation. Nothing in
 * the wire says so, which is why the proxy cannot conclude the client has
 * moved on — it can only refuse to hold an unbounded number of the sessions
 * such a run leaves behind.
 */
const oneShotDecision = (harness: Harness, step: number) =>
  streamTurn(harness.url, {
    model: "fake/model-a",
    stream: true,
    messages: [
      { role: "system", content: "decide one action" },
      { role: "user", content: `step ${step}` }
    ],
    tools: [{ type: "function", function: { name: "list_tabs" } }]
  })

describe("a client that never resumes its turns", () => {
  it("does not accumulate a parked session per decision", async () => {
    harness = await startHarness({ mode: "tool" })

    for (let step = 1; step <= 12; step += 1) {
      const decision = await oneShotDecision(harness, step)
      expect(decision.finishReason).toBe("tool_calls")
      expect(decision.toolCalls).toHaveLength(1)
    }

    // Bounded by the cap rather than growing with the run: twelve steps used
    // to leave twelve live backend sessions parked for ten minutes each.
    const held = harness.routes.inspect()
    expect(held.parkedTurns).toBeLessThanOrEqual(
      resolveConfig({}).MAX_PARKED_TURNS
    )
    expect(held.pendingCalls).toBe(held.parkedTurns)
  })

  it("keeps answering after a long run rather than blocking on what it left", async () => {
    harness = await startHarness({ mode: "tool" })
    for (let step = 1; step <= 12; step += 1) {
      await oneShotDecision(harness, step)
    }
    // The queue slot is released when a turn suspends, so the run's own steps
    // never queued behind each other; this asserts the twelfth answers as the
    // first did rather than waiting behind eleven parked sessions.
    const last = await oneShotDecision(harness, 13)
    expect(last.status).toBe(200)
    expect(last.finishReason).toBe("tool_calls")
  })

  it("discards the oldest parked turn first", async () => {
    harness = await startHarness({ mode: "tool" }, { MAX_PARKED_TURNS: 2 })
    const first = await oneShotDecision(harness, 1)
    const second = await oneShotDecision(harness, 2)
    await oneShotDecision(harness, 3)

    // The oldest is gone, so its result is refused rather than joined to
    // whatever turn happens to be live now.
    const stale = await streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      messages: [
        { role: "user", content: "step 1" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: first.toolCalls[0]?.id,
              type: "function",
              function: first.toolCalls[0]?.function
            }
          ]
        },
        {
          role: "tool",
          tool_call_id: first.toolCalls[0]?.id,
          content: "two tabs"
        }
      ],
      tools: [{ type: "function", function: { name: "list_tabs" } }]
    })
    expect(stale.status).toBe(400)
    expect(stale.content).toContain("StaleToolResults")
    expect(second.toolCalls[0]?.id).toBeDefined()
  })

  it("settles a turn whose resume is still queued when the proxy shuts down", async () => {
    /**
     * A resuming turn is taken out of the parked map — a request carrying its
     * results already exists, so its deadlines are suspended — which meant a
     * shutdown that walked that map alone left the session, the hold and the
     * suspended calls behind. The calls were the worst of it: their timers
     * were cleared on the way in, so nothing was ever going to settle them.
     */
    harness = await startHarness({ mode: "tool" })
    const first = await oneShotDecision(harness, 1)
    const call = first.toolCalls[0]

    // Occupy the single-flight slot so the resume below waits behind it, which
    // is the window the hold exists for.
    const slow = streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      messages: [{ role: "user", content: SLOW_TURN_MARKER }]
    })
    const resumed = streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      messages: [
        { role: "user", content: "step 1" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: call?.id, type: "function", function: call?.function }
          ]
        },
        { role: "tool", tool_call_id: call?.id, content: "two tabs" }
      ],
      tools: [{ type: "function", function: { name: "list_tabs" } }]
    })
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(harness.routes.inspect()).toMatchObject({
      parkedTurns: 0,
      resumeHolds: 1,
      pendingCalls: 1
    })

    await harness.routes.shutdown()
    expect(harness.routes.inspect()).toEqual({
      parkedTurns: 0,
      pendingCalls: 0,
      resumeHolds: 0
    })
    await slow
    await resumed
  })

  it("leaves nothing held once the proxy shuts down", async () => {
    harness = await startHarness({ mode: "tool" })
    await oneShotDecision(harness, 1)
    await oneShotDecision(harness, 2)
    expect(harness.routes.inspect().parkedTurns).toBeGreaterThan(0)

    await harness.routes.shutdown()

    // Both the parked turn and its call settle, and the backend is told to
    // drop the session rather than being left to a timer nobody will see.
    expect(harness.routes.inspect()).toEqual({
      parkedTurns: 0,
      pendingCalls: 0,
      resumeHolds: 0
    })
    expect(harness.calls.dispose).toBeGreaterThanOrEqual(2)
  })
})

/**
 * Every way a turn can end has to leave the proxy holding nothing.
 *
 * A response that stopped is not a session that settled: a backend turn is a
 * live session and a parked call is a promise something is awaiting, and a
 * test that asserted only the response body could not tell one from the
 * other. `inspect` is what makes the difference visible.
 */
describe("terminal paths settle the session and the slot", () => {
  const held = () => harness?.routes.inspect()

  it("settles a plain answer", async () => {
    harness = await startHarness({ mode: "answer", answer: "all good" })
    const turn = await streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      messages: askedForTabs
    })
    expect(turn.finishReason).toBe("stop")
    expect(held()).toEqual({
      parkedTurns: 0,
      pendingCalls: 0,
      resumeHolds: 0
    })
    expect(harness.calls.dispose).toBe(1)
  })

  it("settles a turn the backend failed", async () => {
    harness = await startHarness({ mode: "fail" })
    const turn = await streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      messages: askedForTabs
    })
    expect(turn.error ?? turn.status).toBeTruthy()
    expect(held()).toEqual({
      parkedTurns: 0,
      pendingCalls: 0,
      resumeHolds: 0
    })
  })

  it("settles a model the catalog does not have", async () => {
    harness = await startHarness({ mode: "answer" })
    const turn = await streamTurn(harness.url, {
      model: "fake/not-a-model",
      stream: true,
      messages: askedForTabs
    })
    expect(turn.status).toBe(400)
    // Refused before a session was ever started, so nothing to settle.
    expect(harness.calls.startTurn).toBe(0)
    expect(held()).toEqual({
      parkedTurns: 0,
      pendingCalls: 0,
      resumeHolds: 0
    })
  })

  it("settles a resumed turn once its result is delivered", async () => {
    harness = await startHarness({ mode: "tool" })
    const first = await oneShotDecision(harness, 1)
    const call = first.toolCalls[0]
    expect(held()).toMatchObject({ parkedTurns: 1, pendingCalls: 1 })

    const resumed = await streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      messages: [
        { role: "user", content: "step 1" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: call?.id, type: "function", function: call?.function }
          ]
        },
        { role: "tool", tool_call_id: call?.id, content: "two tabs" }
      ],
      tools: [{ type: "function", function: { name: "list_tabs" } }]
    })
    expect(resumed.finishReason).toBe("stop")
    expect(held()).toEqual({
      parkedTurns: 0,
      pendingCalls: 0,
      resumeHolds: 0
    })
  })
})

describe("images the client attached", () => {
  it("reaches the backend as a part, not flattened into the text", async () => {
    /**
     * An `image_url` part carries no `text`, so a message flattened to a
     * string drops it and leaves the model answering about a picture it never
     * saw. Asserted here, through the route, and not only over the wire
     * helper: this is the path a vision agent decision actually takes.
     */
    harness = await startHarness({ mode: "answer", answer: "a cat" })
    const dataUrl = "data:image/png;base64,AAAA"
    await streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what is in this picture?" },
            { type: "image_url", image_url: { url: dataUrl } }
          ]
        }
      ]
    })

    const started = JSON.stringify(harness.calls.startedMessages.at(-1))
    expect(started).toContain("what is in this picture?")
    expect(started).toContain(dataUrl)
  })
})
