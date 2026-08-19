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
import type { ProxyConfig, ToolResultMessage } from "../../types.js"
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
  mode: "answer" | "tool" | "fail"
  answer?: string
}

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
  const calls = { startTurn: 0, dispose: 0, abort: 0 }
  let nextId = 0

  class FakeTurn implements BackendTurn {
    readonly id: string
    private toolPromise: Promise<string> | null = null
    private toolOutput = ""
    private streamed = ""

    constructor(id: string) {
      this.id = id
    }

    async run(
      handlers: TurnStreamHandlers,
      signals: TurnRunSignals
    ): Promise<TurnResult> {
      if (options.mode === "fail") {
        return {
          status: "failed",
          error: { message: "upstream exploded", type: "FakeError" }
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
    startTurn: async () => {
      calls.startTurn += 1
      nextId += 1
      const turn = new FakeTurn(`turn_${nextId}`)
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
  calls: { startTurn: number; dispose: number; abort: number }
}

const startHarness = async (
  options: FakeBackendOptions,
  configOverrides: Partial<ProxyConfig> = {}
): Promise<Harness> => {
  const config: ProxyConfig = {
    ...resolveConfig({ BRIDGE_BATCH_MS: 0 }),
    ...configOverrides
  }
  const pending = new PendingToolCalls({ timeoutMs: 5000 })
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

  return { url: `http://127.0.0.1:${port}`, server, calls }
}

interface StreamedTurn {
  status: number
  content: string
  finishReason: string | null
  toolCalls: {
    id: string
    function: { name: string; arguments: string }
  }[]
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
      toolCalls: []
    }
  }

  const text = await response.text()
  const result: StreamedTurn = {
    status: response.status,
    content: "",
    finishReason: null,
    toolCalls: []
  }
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue
    const payload = line.slice(6).trim()
    if (payload === "[DONE]") continue
    const choice = JSON.parse(payload).choices?.[0]
    if (choice?.delta?.content) result.content += choice.delta.content
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
