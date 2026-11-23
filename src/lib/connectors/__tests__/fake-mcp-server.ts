/**
 * In-memory Streamable HTTP MCP server, served through an injected `fetch`.
 * Behaviour switches let a test break exactly one part of the protocol.
 */

export interface FakeTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  annotations?: Record<string, unknown>
  run?: (args: Record<string, unknown>) => unknown
}

export interface FakeServerOptions {
  tools?: FakeTool[]
  protocolVersion?: string
  respondWith?: "json" | "sse"
  pageSize?: number
  requireToken?: string
}

export interface RecordedRequest {
  method: string
  httpMethod: string
  headers: Record<string, string>
  body: Record<string, unknown> | undefined
}

export const createFakeMcpServer = (options: FakeServerOptions = {}) => {
  const tools = options.tools ?? []
  const requests: RecordedRequest[] = []
  const executions: Array<{ name: string; args: Record<string, unknown> }> = []
  let sessionCounter = 0
  let session: string | undefined
  /** Next tools/call answers with this HTTP status after running the tool. */
  let failNextCallAfterRunWith: number | undefined
  /** Next `notifications/initialized` answers with this HTTP status. */
  let failNextNotificationWith: number | undefined
  /** Expire the session before the next non-initialize request. */
  let expireBeforeNext = false
  /** Hold every response open until aborted. */
  let hang = false
  let serverRequestsBeforeResult: unknown[] = []

  const json = (status: number, body: unknown, headers = {}) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers }
    })

  const sse = (messages: unknown[], headers = {}) => {
    const text = messages
      .map(
        (message) =>
          `event: message\r\ndata: ${JSON.stringify(message)}\r\n\r\n`
      )
      .join(": keep-alive\r\n\r\n")
    const encoder = new TextEncoder()
    const bytes = encoder.encode(text)
    /** Split at an awkward byte offset so events straddle chunks. */
    const cut = Math.max(1, Math.floor(bytes.length / 3) + 1)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut))
        controller.enqueue(bytes.slice(cut))
        controller.close()
      }
    })
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream", ...headers }
    })
  }

  const reply = (id: unknown, result: unknown) => {
    const message = { jsonrpc: "2.0", id, result }
    const headers = session ? { "Mcp-Session-Id": session } : {}
    if (options.respondWith === "sse") {
      return sse(
        [
          { jsonrpc: "2.0", method: "notifications/progress", params: {} },
          ...serverRequestsBeforeResult,
          message
        ],
        headers
      )
    }
    return json(200, message, headers)
  }

  const fetchImpl = async (
    _input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const headers = Object.fromEntries(
      new Headers(init?.headers).entries()
    ) as Record<string, string>
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    const method = typeof body?.method === "string" ? body.method : "(none)"
    requests.push({ method, httpMethod: init?.method ?? "GET", headers, body })

    if (hang) {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError"))
        )
      })
    }
    if (
      options.requireToken &&
      headers.authorization !== `Bearer ${options.requireToken}`
    ) {
      return json(401, { error: "unauthorized" })
    }
    if (init?.method === "DELETE") return json(200, undefined)
    if (body && !("method" in body)) return json(202, undefined)

    if (method === "initialize") {
      sessionCounter += 1
      session = `session-${sessionCounter}`
      return reply(body.id, {
        protocolVersion:
          options.protocolVersion ?? body.params?.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "fake-server", version: "1.0.0" }
      })
    }
    if (expireBeforeNext) {
      expireBeforeNext = false
      session = undefined
    }
    if (headers["mcp-session-id"] !== session) return json(404, undefined)
    if (method === "notifications/initialized") {
      if (failNextNotificationWith !== undefined) {
        const status = failNextNotificationWith
        failNextNotificationWith = undefined
        return json(status, undefined)
      }
      return json(202, undefined)
    }

    if (method === "tools/list") {
      const size = options.pageSize ?? tools.length
      const start = Number(body.params?.cursor ?? 0)
      const page = tools.slice(start, start + size).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
        annotations: tool.annotations
      }))
      const next =
        start + size < tools.length ? String(start + size) : undefined
      return reply(body.id, {
        tools: page,
        ...(next ? { nextCursor: next } : {})
      })
    }

    if (method === "tools/call") {
      const tool = tools.find((item) => item.name === body.params?.name)
      if (!tool) {
        return json(200, {
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32602, message: `Unknown tool ${body.params?.name}` }
        })
      }
      const args = (body.params?.arguments ?? {}) as Record<string, unknown>
      executions.push({ name: tool.name, args })
      let ran: unknown
      try {
        ran = tool.run?.(args)
      } catch (error) {
        return json(200, {
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32603, message: String(error) }
        })
      }
      const result = ran ?? {
        content: [{ type: "text", text: `ran ${tool.name}` }]
      }
      if (failNextCallAfterRunWith !== undefined) {
        const status = failNextCallAfterRunWith
        failNextCallAfterRunWith = undefined
        return json(status, undefined)
      }
      return reply(body.id, result)
    }

    return json(200, {
      jsonrpc: "2.0",
      id: body?.id,
      error: { code: -32601, message: "Method not found" }
    })
  }

  return {
    fetch: fetchImpl as typeof fetch,
    requests,
    executions,
    get session() {
      return session
    },
    failNextNotification(status: number) {
      failNextNotificationWith = status
    },
    failNextCallAfterRun(status: number) {
      failNextCallAfterRunWith = status
    },
    expireSession() {
      expireBeforeNext = true
    },
    hangForever() {
      hang = true
    },
    interleaveServerRequest(message: unknown) {
      serverRequestsBeforeResult = [message]
    }
  }
}
