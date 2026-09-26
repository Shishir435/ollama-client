/**
 * Apple Foundation Models backend.
 *
 * macOS 27 ships `fm`, whose `fm serve` already speaks Chat Completions. It is
 * not reachable from a browser extension directly: it answers a CORS
 * preflight and then refuses the request itself with `403 Cross-site requests
 * are not allowed` whenever an `Origin` header is present, which an
 * extension's fetch always sends. This adapter runs `fm serve` on a private
 * Unix socket and relays turns to it, so the proxy's own origin policy is the
 * one that applies.
 *
 * What the model is, measured rather than assumed: one on-device model with
 * an 8K context (7.5K prompt tokens were accepted, 12.5K refused as exceeding
 * it), text and images in, text out. It answered in text when offered tools,
 * so the catalog reports no tool calling and the client never sends any.
 */
import { type ChildProcess, spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { request as httpRequest, type IncomingMessage } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { stringOption } from "../../config.js"
import type { OpenAIMessage } from "../../types.js"
import type {
  AgentBackend,
  BackendContext,
  BackendTurn,
  CatalogModel,
  TurnResult,
  TurnRunSignals,
  TurnStreamHandlers
} from "../types.js"
import { BackendInputError } from "../types.js"

export const FM_PROVIDER_ID = "apple"
export const FM_MODEL_ID = "foundation"
/** The name `fm serve` itself gives its only model. */
const FM_WIRE_MODEL = "system"
export const FM_CONTEXT_LENGTH = 8192
const READY_TIMEOUT_MS = 15_000

export const FM_CATALOG_MODEL: CatalogModel = {
  id: `${FM_PROVIDER_ID}/${FM_MODEL_ID}`,
  object: "model",
  created: 0,
  owned_by: "apple",
  name: "Apple Foundation Model (on-device)",
  context_length: FM_CONTEXT_LENGTH,
  input_modalities: ["text", "image"],
  output_modalities: ["text"],
  supported_parameters: [],
  capabilities: { function_calling: false, vision: true, reasoning: false }
}

const MODEL_ALIASES = new Set([
  "",
  FM_CATALOG_MODEL.id,
  FM_MODEL_ID,
  FM_WIRE_MODEL,
  `${FM_PROVIDER_ID}/${FM_WIRE_MODEL}`
])

/**
 * Only what `fm serve` accepts. Tool calls and tool results cannot occur —
 * nothing was offered — but a client replaying an old conversation might
 * carry them, and they are dropped rather than forwarded as roles the server
 * does not know.
 */
export const toFmMessages = (messages: OpenAIMessage[]) =>
  messages
    .filter((message) =>
      ["system", "user", "assistant"].includes(String(message.role))
    )
    .map((message) => ({ role: message.role, content: message.content ?? "" }))

/**
 * The server's own messages are passed on, with the two a person can act on
 * said in terms of what to do: the conversation is too long for the window,
 * or Apple's filter declined it.
 */
export const describeFmError = (status: number, body: string): string => {
  let message = body.trim()
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } }
    message = parsed.error?.message ?? message
  } catch {
    /* A non-JSON body is reported as it stands. */
  }
  if (/context size/i.test(message))
    return `The conversation is longer than the Apple Foundation Model's ${FM_CONTEXT_LENGTH / 1024}K context. Start a new chat or send less context.`
  if (/guardrail/i.test(message))
    return "Apple's safety guardrails declined this request."
  return `fm serve returned ${status}: ${message || "no detail"}`
}

/** Feed SSE text in; complete `data:` payloads come out. */
export const createSseReader = (onData: (payload: string) => void) => {
  let buffer = ""
  return (chunk: string) => {
    buffer += chunk
    let boundary = buffer.indexOf("\n")
    while (boundary !== -1) {
      const line = buffer.slice(0, boundary).replace(/\r$/, "")
      buffer = buffer.slice(boundary + 1)
      if (line.startsWith("data:")) onData(line.slice(5).trim())
      boundary = buffer.indexOf("\n")
    }
  }
}

interface FmStreamChunk {
  choices?: Array<{
    delta?: { content?: string | null }
    finish_reason?: string | null
  }>
  error?: { message?: string }
}

export const createFmBackend = (context: BackendContext): AgentBackend => {
  const { log } = context
  /** CLI, then environment, then config file, as every other option. */
  const executable = stringOption(
    context.options.FM_PATH,
    process.env.OLC_FM_PATH,
    context.fileOptions.FM_PATH,
    "fm"
  )
  const turns = new Map<string, FmTurn>()
  let child: ChildProcess | undefined
  let socketDir: string | undefined
  let socketPath: string | undefined
  let starting: Promise<void> | undefined
  /**
   * Set only once `/health` answered. `child` and `socketPath` exist from the
   * spawn onward, so a second caller keyed on them raced a socket that was
   * not listening yet.
   */
  let ready = false

  const call = (
    method: "GET" | "POST",
    route: string,
    body?: unknown,
    signal?: AbortSignal
  ): Promise<IncomingMessage> =>
    new Promise((resolve, reject) => {
      if (!socketPath) {
        reject(new Error("fm serve is not running"))
        return
      }
      const payload = body === undefined ? undefined : JSON.stringify(body)
      const req = httpRequest(
        {
          socketPath,
          path: route,
          method,
          headers: payload
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(payload)
              }
            : {},
          signal
        },
        resolve
      )
      req.on("error", reject)
      if (payload) req.write(payload)
      req.end()
    })

  const readBody = async (response: IncomingMessage): Promise<string> => {
    let text = ""
    response.setEncoding("utf8")
    for await (const chunk of response) text += chunk
    return text
  }

  const stopChild = () => {
    ready = false
    child?.kill("SIGTERM")
    child = undefined
    if (socketDir) rmSync(socketDir, { recursive: true, force: true })
    socketDir = undefined
    socketPath = undefined
  }

  const start = async (): Promise<void> => {
    if (process.platform !== "darwin") {
      throw new Error(
        "Apple Foundation Models run only on macOS 27 or later on Apple silicon."
      )
    }
    socketDir = mkdtempSync(path.join(tmpdir(), "olc-fm-"))
    socketPath = path.join(socketDir, "fm.sock")
    const spawned = spawn(executable, ["serve", "--socket", socketPath], {
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, NO_COLOR: "1" }
    })
    child = spawned
    let stderr = ""
    spawned.stderr?.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-2000)
    })
    const exited = new Promise<never>((_, reject) => {
      spawned.once("error", (error) =>
        reject(
          (error as NodeJS.ErrnoException).code === "ENOENT"
            ? new Error(
                `'${executable}' was not found. Apple Foundation Models need macOS 27 or later; set OLC_FM_PATH if fm is installed elsewhere.`
              )
            : error
        )
      )
      spawned.once("exit", (code) =>
        reject(
          new Error(
            `fm serve exited (${code ?? "signal"}) before it was ready${stderr ? `: ${stderr.trim()}` : ""}`
          )
        )
      )
    })
    exited.catch(() => undefined)

    const deadline = Date.now() + READY_TIMEOUT_MS
    while (true) {
      const health = await Promise.race([
        call("GET", "/health")
          .then(async (response) =>
            response.statusCode === 200 ? readBody(response) : undefined
          )
          .catch(() => undefined),
        exited
      ])
      if (health !== undefined) {
        const parsed = JSON.parse(health) as {
          models?: Array<{ name?: string; available?: boolean }>
        }
        const model = parsed.models?.find(
          (entry) => entry.name === FM_WIRE_MODEL
        )
        if (model && model.available === false) {
          throw new Error(
            "The Apple Foundation Model is not available on this Mac. Turn on Apple Intelligence in System Settings and let the model finish downloading; `fm available` reports its state."
          )
        }
        ready = true
        log("fm serve ready", { socket: "private" })
        spawned.removeAllListeners("exit")
        spawned.once("exit", (code) => {
          log("fm serve exited", { code })
          if (child === spawned) stopChild()
        })
        return
      }
      if (Date.now() > deadline)
        throw new Error("fm serve did not become ready in time")
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }

  class FmTurn implements BackendTurn {
    readonly id: string
    private readonly controller = new AbortController()

    constructor(
      id: string,
      private readonly messages: OpenAIMessage[]
    ) {
      this.id = id
    }

    async run(
      handlers: TurnStreamHandlers,
      signals: TurnRunSignals
    ): Promise<TurnResult> {
      const onAbort = () => this.controller.abort()
      signals.abort?.addEventListener("abort", onAbort, { once: true })
      let content = ""
      let finish: string | null = null
      let done = false
      let streamError: string | undefined
      try {
        const response = await call(
          "POST",
          "/v1/chat/completions",
          {
            model: FM_WIRE_MODEL,
            stream: true,
            messages: toFmMessages(this.messages)
          },
          this.controller.signal
        )
        if (response.statusCode !== 200) {
          const body = await readBody(response)
          return {
            status: "failed",
            error: {
              message: describeFmError(response.statusCode ?? 500, body),
              type: "BackendError"
            }
          }
        }
        const read = createSseReader((payload) => {
          if (payload === "[DONE]") {
            done = true
            return
          }
          let chunk: FmStreamChunk
          try {
            chunk = JSON.parse(payload) as FmStreamChunk
          } catch {
            return
          }
          if (chunk.error?.message) streamError = chunk.error.message
          const choice = chunk.choices?.[0]
          const text = choice?.delta?.content
          if (text) {
            content += text
            handlers.onText(text)
          }
          if (choice?.finish_reason) finish = choice.finish_reason
        })
        response.setEncoding("utf8")
        for await (const chunk of response) read(String(chunk))
        if (streamError) {
          return {
            status: "failed",
            error: {
              message: describeFmError(500, streamError),
              type: "BackendError"
            }
          }
        }
        /**
         * A response that ends with neither a finish reason nor `[DONE]` was
         * cut off mid-generation; reporting it complete would present a
         * truncated answer as the whole one.
         */
        if (!done && !finish) {
          return {
            status: "failed",
            error: {
              message:
                "fm serve ended the response before the answer finished.",
              type: "BackendError"
            }
          }
        }
        return { status: "completed", content, reasoning: "", finish }
      } finally {
        signals.abort?.removeEventListener("abort", onAbort)
      }
    }

    async resume(): Promise<TurnResult> {
      return {
        status: "failed",
        error: {
          message: "The Apple Foundation Model does not call tools.",
          type: "BadRequest"
        }
      }
    }

    async abort(): Promise<void> {
      this.controller.abort()
    }

    async dispose(): Promise<void> {
      this.controller.abort()
      turns.delete(this.id)
    }
  }

  return {
    id: "fm",
    ensureReady: async () => {
      if (ready) return
      starting ??= start()
        .catch((error) => {
          stopChild()
          throw error
        })
        .finally(() => {
          starting = undefined
        })
      await starting
    },
    listModels: async () => [FM_CATALOG_MODEL],
    resolveModel: async (requested) => {
      const wanted = typeof requested === "string" ? requested.trim() : ""
      return MODEL_ALIASES.has(wanted)
        ? { providerId: FM_PROVIDER_ID, modelId: FM_MODEL_ID }
        : {
            error: `Model '${wanted}' is not served here; the only model is ${FM_CATALOG_MODEL.id}.`
          }
    },
    startTurn: async (input) => {
      if (input.reasoningEffort) {
        throw new BackendInputError(
          "The Apple Foundation Model has no reasoning effort to set."
        )
      }
      if (Array.isArray(input.tools) && input.tools.length > 0) {
        log("Ignoring tools the Apple Foundation Model cannot call", {
          requestId: input.requestId,
          count: input.tools.length
        })
      }
      const turn = new FmTurn(`fm-${input.requestId}`, input.messages)
      turns.set(turn.id, turn)
      return turn
    },
    findTurn: (turnId) => turns.get(turnId),
    inspect: () => ({
      managed: true,
      bridge: { enabled: false, pluginLinked: false, pluginConfirmed: null }
    }),
    shutdown: async () => {
      await Promise.allSettled([...turns.values()].map((turn) => turn.abort()))
      turns.clear()
      stopChild()
    }
  }
}
