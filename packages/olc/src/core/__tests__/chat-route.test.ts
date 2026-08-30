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
    reasoningEfforts: Array<ReasoningEffort | undefined>
  } = { startTurn: 0, dispose: 0, abort: 0, reasoningEfforts: [] }
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
    ensureReady: async () => {},
    listModels: async () => [MODEL],
    resolveModel: async (requested) =>
      requested === "fake/model-a"
        ? { providerId: "fake", modelId: "model-a" }
        : { error: `Model '${String(requested)}' is not in the catalog.` },
    startTurn: async (input) => {
      calls.startTurn += 1
      calls.reasoningEfforts.push(input.reasoningEffort)
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
  calls: {
    startTurn: number
    dispose: number
    abort: number
    reasoningEfforts: Array<ReasoningEffort | undefined>
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
  registerChatRoutes(router, {
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

  return { url: `http://127.0.0.1:${port}`, server, calls, pending }
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
    const choice = JSON.parse(payload).choices?.[0]
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

  it("reports a backend failure in the stream without leaking the turn", async () => {
    harness = await startHarness({ mode: "fail" })
    const turn = await streamTurn(harness.url, {
      model: "fake/model-a",
      stream: true,
      messages: askedForTabs
    })

    expect(turn.content).toContain("[Proxy Error] FakeError: upstream exploded")
    expect(turn.finishReason).toBe("stop")
    expect(harness.calls.dispose).toBe(1)
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
