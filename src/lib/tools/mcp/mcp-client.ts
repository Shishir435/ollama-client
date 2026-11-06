/**
 * Streamable-HTTP MCP client (JSON-RPC 2.0).
 *
 * Speaks the transport used by LM Studio's own MCP config (`streamableHttp`):
 * one POST per request, `Accept: text/event-stream`, response is either an SSE
 * stream or a single JSON body. Each request is independent; servers that keep
 * state across calls (WordCraft's open documents) should be run through the
 * companion bridge in `tools/mcp-bridge/`, which multiplexes all requests onto
 * one stdio session.
 */

import type { McpServer, McpTool } from "./types"

/** Network-level failure: worth retrying after re-initializing the session. */
export class McpConnectionError extends Error {
  readonly retryable: boolean

  constructor(message: string, options?: { retryable?: boolean }) {
    super(message)
    this.name = "McpConnectionError"
    this.retryable = options?.retryable ?? false
  }
}

const JSONRPC_VERSION = "2.0"

interface JsonRpcRequest {
  jsonrpc: string
  id: number
  method: string
  params?: unknown
}

type JsonRpcResponse =
  | { jsonrpc: string; id: number; result: unknown }
  | {
      jsonrpc: string
      id: number
      error: { code: number; message: string; data?: unknown }
    }

interface ParsedEvent {
  id?: number
  kind: "result" | "error" | "other"
  payload?: unknown
}

const parseSseEvent = (raw: string): ParsedEvent | null => {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const message = JSON.parse(trimmed) as JsonRpcResponse
    if (message.id === undefined) return { kind: "other" }
    if ("result" in message)
      return { id: message.id, kind: "result", payload: message.result }
    if ("error" in message)
      return { id: message.id, kind: "error", payload: message.error }
    return { kind: "other" }
  } catch {
    return null
  }
}

/** Read an SSE body until the event carrying our request id arrives. */
const readSseResponse = async (
  stream: ReadableStream<Uint8Array>,
  requestId: number,
  deadline: number
): Promise<ParsedEvent> => {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    if (Date.now() > deadline)
      throw new McpConnectionError("MCP response timed out", {
        retryable: false
      })
    let chunk: { done: boolean; value?: Uint8Array }
    try {
      chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("sse read deadline")),
            Math.max(0, deadline - Date.now())
          )
        )
      ])
    } catch {
      throw new McpConnectionError("MCP response timed out", {
        retryable: false
      })
    }
    if (chunk.done) break
    buffer += decoder.decode(chunk.value ?? new Uint8Array(0), { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    let dataLine = ""
    for (const line of lines) {
      if (line.startsWith("data:")) {
        dataLine += line.slice(5).trim()
        continue
      }
      if (!dataLine) continue
      const event = parseSseEvent(dataLine)
      dataLine = ""
      if (!event) continue
      if (event.id === requestId) return event
    }
  }
  throw new Error("MCP response stream ended without a result")
}

/** Read a response body stream fully and decode it as UTF-8 text. */
const readBodyText = async (
  stream: ReadableStream<Uint8Array> | null
): Promise<string> => {
  if (!stream) return ""
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    buffer += decoder.decode(chunk.value ?? new Uint8Array(0), { stream: true })
  }
  return buffer
}

/** POST one JSON-RPC request; maps network and abort failures to McpConnectionError. */
const fetchJsonRpc = async (
  url: string,
  method: string,
  id: number,
  params: unknown,
  signal: AbortSignal
): Promise<Response> => {
  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream; charset=utf-8"
      },
      body: JSON.stringify({
        jsonrpc: JSONRPC_VERSION,
        id,
        method,
        params
      } satisfies JsonRpcRequest),
      signal
    })
  } catch (error) {
    if (signal.aborted) {
      const reason =
        signal.reason instanceof Error
          ? signal.reason
          : new Error("MCP request aborted")
      throw new McpConnectionError(reason.message, { retryable: false })
    }
    throw new McpConnectionError(
      `Could not reach MCP server at ${url}: ${error instanceof Error ? error.message : String(error)}`,
      { retryable: true }
    )
  }
}

/** Parse the response body (SSE or JSON) into a ParsedEvent for our request id. */
const parseResponse = async (
  response: Response,
  id: number,
  deadline: number
): Promise<ParsedEvent> => {
  const contentType = response.headers.get("content-type") ?? ""
  if (contentType.includes("text/event-stream")) {
    if (!response.body)
      throw new McpConnectionError("MCP server returned an empty response body")
    return readSseResponse(response.body, id, deadline)
  }
  const bodyText = await readBodyText(response.body)
  if (!response.ok) {
    throw new McpConnectionError(
      `MCP server returned HTTP ${response.status}: ${bodyText.slice(0, 200)}`,
      { retryable: false }
    )
  }
  try {
    const message = JSON.parse(bodyText) as JsonRpcResponse
    if (message.id !== id) throw new Error("Unexpected response id")
    return "result" in message
      ? { id, kind: "result", payload: message.result }
      : { id, kind: "error", payload: message.error }
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error))
  }
}

export class McpClient {
  private readonly server: McpServer
  private readonly timeoutMs: number
  private nextId = 1
  private initialized = false

  constructor(server: McpServer, timeoutMs = 120_000) {
    this.server = server
    this.timeoutMs = timeoutMs
  }

  /** Server name and protocol version. Throws on failure; caller retries once. */
  async initialize(
    signal?: AbortSignal
  ): Promise<{ name: string; protocolVersion: string }> {
    const response = await this.request<unknown>("initialize", {}, signal)
    this.initialized = true
    const info = response as {
      server?: { name?: string }
      protocolVersion?: string
    }
    return {
      name: info.server?.name ?? this.server.name,
      protocolVersion: info.protocolVersion ?? "unknown"
    }
  }

  /** No-op after the first successful handshake; cheap to call before each use. */
  async ensureInitialized(signal?: AbortSignal): Promise<void> {
    if (!this.initialized) await this.initialize(signal)
  }

  /** Drop session state so the next request re-handshakes. */
  reset(): void {
    this.initialized = false
  }

  async listTools(signal?: AbortSignal): Promise<McpTool[]> {
    const response = await this.request<unknown>("tools/list", {}, signal)
    const tools = (response as { tools?: McpTool[] }).tools ?? []
    return tools
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<string> {
    const response = await this.request<unknown>(
      "tools/call",
      { name, arguments: args },
      signal
    )
    const result = response as {
      content?: Array<{ type: string; text?: string }>
    }
    if (result.content?.length) {
      return result.content.map((part) => part.text ?? "").join("\n")
    }
    return "No output"
  }

  private async request<T>(
    method: string,
    params: unknown,
    signal?: AbortSignal
  ): Promise<T> {
    const id = this.nextId++
    const controller = new AbortController()
    let externalCleanup: (() => void) | undefined
    if (signal) {
      const onAbort = () => controller.abort(signal.reason as Error)
      externalCleanup = () => {
        signal.removeEventListener("abort", onAbort)
        onAbort()
      }
      signal.addEventListener("abort", onAbort, { once: true })
    }
    const timeoutId = setTimeout(
      () =>
        controller.abort(
          new Error(`MCP request timed out after ${this.timeoutMs} ms`)
        ),
      this.timeoutMs
    )

    try {
      const response = await fetchJsonRpc(
        this.server.url,
        method,
        id,
        params,
        controller.signal
      )
      const parsed = await parseResponse(
        response,
        id,
        Date.now() + this.timeoutMs
      )
      if (parsed.kind === "error") {
        const err = parsed.payload as { code: number; message: string }
        throw new Error(`MCP tool error (${err.code}): ${err.message}`)
      }
      return parsed.payload as T
    } finally {
      clearTimeout(timeoutId)
      externalCleanup?.()
    }
  }
}
