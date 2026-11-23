import { mapMcpCallResult, type McpCallOutput } from "./content"
import { SseParser } from "./sse"

/**
 * Minimal MCP client for the Streamable HTTP transport.
 *
 * Hand-written rather than the official SDK: the SDK validates schemas with a
 * code-generating validator, which MV3's CSP forbids, and the extension needs
 * only the tool slice of the protocol. What it does implement follows the spec:
 * version negotiation, `notifications/initialized`, the `Mcp-Session-Id` and
 * `MCP-Protocol-Version` headers, re-initializing on a 404 for an expired
 * session, and JSON or SSE response bodies.
 *
 * Errors carry what was learned about delivery, because the tool source must
 * never replay a call that may already have run.
 */

export const MCP_LATEST_PROTOCOL_VERSION = "2025-11-25"
export const MCP_SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05"
]

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_BODY_BYTES = 16 * 1024 * 1024
const MAX_LIST_PAGES = 10
const MAX_SERVER_MESSAGE_CHARS = 500

export type McpFailureKind =
  | "unreachable"
  | "unauthorized"
  | "not_mcp"
  | "unsupported_version"
  | "timeout"
  | "server_error"
  | "session_expired"
  | "aborted"
  | "rpc_error"

/**
 * - `no`: the server cannot have acted on the request (refused, never sent).
 * - `unknown`: it may have; a consequential call must not be repeated.
 */
export type McpDelivery = "no" | "unknown"

export class McpError extends Error {
  readonly kind: McpFailureKind
  readonly delivery: McpDelivery
  readonly status?: number
  /** JSON-RPC error code, for `rpc_error`. */
  readonly code?: number

  constructor(
    kind: McpFailureKind,
    message: string,
    options: { delivery: McpDelivery; status?: number; code?: number }
  ) {
    super(message)
    this.name = "McpError"
    this.kind = kind
    this.delivery = options.delivery
    this.status = options.status
    this.code = options.code
  }
}

export interface McpListedTool {
  name: string
  title?: string
  description?: string
  inputSchema: Record<string, unknown>
  annotations?: Record<string, unknown>
}

export interface McpClientOptions {
  url: string
  /** Credential headers; read per request so a rotated secret applies at once. */
  authHeaders?: () => Record<string, string>
  fetch?: typeof fetch
  timeoutMs?: number
  clientVersion: string
}

interface JsonRpcMessage {
  jsonrpc?: unknown
  id?: unknown
  method?: unknown
  result?: unknown
  error?: { code?: unknown; message?: unknown }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

/**
 * JSON-RPC errors that prove the request was refused before it ran: it could
 * not be parsed, was malformed, named no method, or had invalid parameters
 * (MCP's answer to an unknown tool). Any other error — an internal error or a
 * server-defined code — may follow a side effect, so delivery stays unknown.
 */
const PRE_EXECUTION_ERROR_CODES = new Set([-32700, -32600, -32601, -32602])

const cancelled = (): McpError =>
  new McpError("aborted", "MCP request was cancelled", { delivery: "unknown" })

export class McpClient {
  private readonly options: McpClientOptions
  private readonly fetchImpl: typeof fetch
  private nextId = 1
  private sessionId: string | undefined
  private protocolVersion: string | undefined
  private initializing: Promise<void> | null = null
  /**
   * Set only once `notifications/initialized` was accepted: the negotiated
   * version alone does not mean the session may carry normal requests.
   */
  private ready = false
  private serverName: string | undefined

  constructor(options: McpClientOptions) {
    this.options = options
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init))
  }

  get server(): { name?: string; protocolVersion?: string } {
    return { name: this.serverName, protocolVersion: this.protocolVersion }
  }

  /** Forget the session so the next request starts a fresh handshake. */
  reset(): void {
    this.sessionId = undefined
    this.protocolVersion = undefined
    this.ready = false
    this.initializing = null
  }

  async ensureInitialized(signal?: AbortSignal): Promise<void> {
    if (this.ready) return
    if (!this.initializing) {
      const run = this.handshake(signal)
      this.initializing = run
      run.catch(() => {
        if (this.initializing === run) this.initializing = null
      })
    }
    await this.initializing
  }

  async listTools(signal?: AbortSignal): Promise<McpListedTool[]> {
    const tools: McpListedTool[] = []
    let cursor: string | undefined
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const result = await this.request(
        "tools/list",
        cursor ? { cursor } : {},
        signal
      )
      const record = isObject(result) ? result : {}
      const listed = Array.isArray(record.tools) ? record.tools : []
      for (const raw of listed) {
        if (!isObject(raw) || typeof raw.name !== "string" || !raw.name) {
          continue
        }
        tools.push({
          name: raw.name,
          title: typeof raw.title === "string" ? raw.title : undefined,
          description:
            typeof raw.description === "string" ? raw.description : undefined,
          inputSchema: isObject(raw.inputSchema)
            ? raw.inputSchema
            : { type: "object", properties: {} },
          annotations: isObject(raw.annotations) ? raw.annotations : undefined
        })
      }
      cursor =
        typeof record.nextCursor === "string" && record.nextCursor
          ? record.nextCursor
          : undefined
      if (!cursor) break
    }
    return tools
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<McpCallOutput> {
    const result = await this.request(
      "tools/call",
      { name, arguments: args },
      signal
    )
    return mapMcpCallResult(result)
  }

  /** End the server-side session, when there is one. Best effort. */
  async close(): Promise<void> {
    const sessionId = this.sessionId
    /** Captured before the reset clears the negotiated protocol version. */
    const headers = { ...this.baseHeaders(), "Mcp-Session-Id": sessionId ?? "" }
    this.reset()
    if (!sessionId) return
    try {
      await this.fetchImpl(this.options.url, { method: "DELETE", headers })
    } catch {
      // The session ends on the server's own timeout instead.
    }
  }

  private async handshake(signal?: AbortSignal): Promise<void> {
    this.sessionId = undefined
    this.protocolVersion = undefined
    this.ready = false
    try {
      await this.negotiate(signal)
      this.ready = true
    } catch (error) {
      /** A half-finished handshake leaves nothing a later call could reuse. */
      this.sessionId = undefined
      this.protocolVersion = undefined
      throw error
    }
  }

  private async negotiate(signal?: AbortSignal): Promise<void> {
    const { result, response } = await this.post(
      "initialize",
      {
        protocolVersion: MCP_LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: "ollama-client",
          version: this.options.clientVersion
        }
      },
      signal,
      { expectResult: true }
    )
    const record = isObject(result) ? result : {}
    const version =
      typeof record.protocolVersion === "string"
        ? record.protocolVersion
        : undefined
    if (!version || !MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
      throw new McpError(
        "unsupported_version",
        `MCP server answered with unsupported protocol version ${String(version)}`,
        { delivery: "no" }
      )
    }
    const sessionId = response.headers.get("mcp-session-id")
    if (sessionId) this.sessionId = sessionId
    this.protocolVersion = version
    const serverInfo = isObject(record.serverInfo) ? record.serverInfo : {}
    this.serverName =
      typeof serverInfo.name === "string"
        ? serverInfo.name.slice(0, 200)
        : undefined
    await this.post("notifications/initialized", undefined, signal, {
      expectResult: false
    })
  }

  /**
   * One JSON-RPC request inside an initialized session. A 404 on a session the
   * server has dropped proves the request was not processed, so it is safe to
   * re-handshake and send it once more — even a consequential tool call.
   */
  private async request(
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<unknown> {
    await this.ensureInitialized(signal)
    try {
      return (await this.post(method, params, signal, { expectResult: true }))
        .result
    } catch (error) {
      if (!(error instanceof McpError) || error.kind !== "session_expired") {
        throw error
      }
      this.reset()
      await this.ensureInitialized(signal)
      return (await this.post(method, params, signal, { expectResult: true }))
        .result
    }
  }

  private baseHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      ...this.options.authHeaders?.()
    }
    if (this.protocolVersion) {
      headers["MCP-Protocol-Version"] = this.protocolVersion
    }
    return headers
  }

  private async post(
    method: string,
    params: Record<string, unknown> | undefined,
    externalSignal: AbortSignal | undefined,
    { expectResult }: { expectResult: boolean }
  ): Promise<{ result: unknown; response: Response }> {
    if (externalSignal?.aborted) {
      throw new McpError("aborted", "MCP request was cancelled", {
        delivery: "no"
      })
    }
    const id = expectResult ? this.nextId++ : undefined
    const controller = new AbortController()
    let timedOut = false
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const onAbort = () => controller.abort()
    externalSignal?.addEventListener("abort", onAbort, { once: true })

    const failAfterSend = (): McpError =>
      timedOut
        ? new McpError(
            "timeout",
            `MCP request timed out after ${timeoutMs} ms`,
            {
              delivery: "unknown"
            }
          )
        : externalSignal?.aborted
          ? cancelled()
          : new McpError("unreachable", "MCP server closed the connection", {
              delivery: "unknown"
            })

    try {
      const headers: Record<string, string> = {
        ...this.baseHeaders(),
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream"
      }
      if (this.sessionId && method !== "initialize") {
        headers["Mcp-Session-Id"] = this.sessionId
      }
      const body = JSON.stringify({
        jsonrpc: "2.0",
        ...(id !== undefined ? { id } : {}),
        method,
        ...(params !== undefined ? { params } : {})
      })

      let response: Response
      try {
        response = await this.fetchImpl(this.options.url, {
          method: "POST",
          headers,
          body,
          signal: controller.signal
        })
      } catch {
        if (timedOut || externalSignal?.aborted) throw failAfterSend()
        throw new McpError(
          "unreachable",
          "Could not reach the MCP server",
          /**
           * A refused connection never delivered anything, but fetch reports a
           * reset mid-request the same way, so delivery stays unknown.
           */
          { delivery: "unknown" }
        )
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw this.httpFailure(response.status, method)
      }
      if (!expectResult || id === undefined) {
        await response.body?.cancel().catch(() => undefined)
        return { result: undefined, response }
      }

      const contentType = response.headers.get("content-type") ?? ""
      let message: JsonRpcMessage | undefined
      try {
        message = contentType.includes("text/event-stream")
          ? await this.readSse(response, id)
          : this.findResponse(parseJson(await readCapped(response)), id)
      } catch (error) {
        if (error instanceof McpError) throw error
        if (timedOut || externalSignal?.aborted) throw failAfterSend()
        throw new McpError("not_mcp", "MCP server sent an unreadable reply", {
          delivery: "unknown"
        })
      }
      if (!message) {
        throw new McpError(
          "not_mcp",
          "MCP server's reply did not answer the request",
          { delivery: "unknown" }
        )
      }
      if (message.error !== undefined) {
        const code =
          typeof message.error?.code === "number" ? message.error.code : -32603
        const text =
          typeof message.error?.message === "string"
            ? message.error.message.slice(0, MAX_SERVER_MESSAGE_CHARS)
            : "Unknown error"
        throw new McpError("rpc_error", `MCP error ${code}: ${text}`, {
          delivery: PRE_EXECUTION_ERROR_CODES.has(code) ? "no" : "unknown",
          code
        })
      }
      return { result: message.result, response }
    } finally {
      clearTimeout(timer)
      externalSignal?.removeEventListener("abort", onAbort)
    }
  }

  private httpFailure(status: number, method: string): McpError {
    if (status === 404 && this.sessionId && method !== "initialize") {
      return new McpError("session_expired", "MCP session expired", {
        delivery: "no",
        status
      })
    }
    if (status === 401 || status === 403) {
      return new McpError(
        "unauthorized",
        `MCP server refused the credentials (HTTP ${status})`,
        { delivery: "no", status }
      )
    }
    if (status >= 500) {
      return new McpError(
        "server_error",
        `MCP server failed (HTTP ${status})`,
        {
          delivery: "unknown",
          status
        }
      )
    }
    return new McpError(
      "not_mcp",
      `MCP server rejected the request (HTTP ${status})`,
      { delivery: "no", status }
    )
  }

  private findResponse(
    payload: unknown,
    id: number
  ): JsonRpcMessage | undefined {
    const messages = Array.isArray(payload) ? payload : [payload]
    for (const message of messages) {
      if (isObject(message) && message.id === id && !("method" in message)) {
        return message as JsonRpcMessage
      }
    }
    return undefined
  }

  /**
   * Read events until the one answering `id`. The server may interleave its
   * own requests (sampling, elicitation); this client offers no such
   * capability, so each is answered with "method not found" rather than left
   * to hang the server.
   */
  private async readSse(
    response: Response,
    id: number
  ): Promise<JsonRpcMessage | undefined> {
    if (!response.body) return undefined
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const parser = new SseParser()
    let bytes = 0
    const handle = (payload: string): JsonRpcMessage | undefined => {
      let message: unknown
      try {
        message = JSON.parse(payload)
      } catch {
        return undefined
      }
      const found = this.findResponse(message, id)
      if (found) return found
      if (
        isObject(message) &&
        typeof message.method === "string" &&
        message.id !== undefined
      ) {
        void this.declineServerRequest(message.id)
      }
      return undefined
    }
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > MAX_BODY_BYTES) {
          throw new McpError("not_mcp", "MCP reply was too large", {
            delivery: "unknown"
          })
        }
        for (const payload of parser.push(
          decoder.decode(chunk.value, { stream: true })
        )) {
          const found = handle(payload)
          if (found) return found
        }
      }
      for (const payload of [
        ...parser.push(decoder.decode()),
        ...parser.end()
      ]) {
        const found = handle(payload)
        if (found) return found
      }
      return undefined
    } finally {
      reader.cancel().catch(() => undefined)
    }
  }

  private async declineServerRequest(requestId: unknown): Promise<void> {
    try {
      const headers: Record<string, string> = {
        ...this.baseHeaders(),
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream"
      }
      if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId
      const response = await this.fetchImpl(this.options.url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: requestId,
          error: { code: -32601, message: "Method not found" }
        })
      })
      await response.body?.cancel().catch(() => undefined)
    } catch {
      // The server times its own request out.
    }
  }
}

const parseJson = (text: string): unknown => JSON.parse(text)

const readCapped = async (response: Response): Promise<string> => {
  if (!response.body) return ""
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ""
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    bytes += chunk.value.byteLength
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new McpError("not_mcp", "MCP reply was too large", {
        delivery: "unknown"
      })
    }
    text += decoder.decode(chunk.value, { stream: true })
  }
  return text + decoder.decode()
}
