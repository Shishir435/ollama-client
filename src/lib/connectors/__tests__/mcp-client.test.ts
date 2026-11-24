/** @vitest-environment node */
import { describe, expect, it } from "vitest"
import {
  MCP_LATEST_PROTOCOL_VERSION,
  McpClient,
  McpError
} from "../mcp/mcp-client"
import { createFakeMcpServer, type FakeServerOptions } from "./fake-mcp-server"

const URL = "http://127.0.0.1:8086/mcp/mail"

const setup = (options: FakeServerOptions = {}, timeoutMs?: number) => {
  const server = createFakeMcpServer({
    tools: [
      { name: "send", annotations: { destructiveHint: true } },
      { name: "search", annotations: { readOnlyHint: true } }
    ],
    ...options
  })
  const client = new McpClient({
    url: URL,
    fetch: server.fetch,
    clientVersion: "0.16.0",
    timeoutMs,
    authHeaders: () => ({ Authorization: "Bearer secret-token" })
  })
  return { server, client }
}

const failure = async (run: () => Promise<unknown>): Promise<McpError> => {
  try {
    await run()
  } catch (error) {
    if (error instanceof McpError) return error
    throw error
  }
  throw new Error("expected an McpError")
}

describe("McpClient handshake", () => {
  it("negotiates, announces initialized, then sends session and version headers", async () => {
    const { server, client } = setup()
    await client.listTools()

    const [init, initialized, list] = server.requests
    expect(init.method).toBe("initialize")
    expect(init.body?.params).toMatchObject({
      protocolVersion: MCP_LATEST_PROTOCOL_VERSION,
      clientInfo: { name: "ollama-client", version: "0.16.0" }
    })
    expect(init.headers["mcp-session-id"]).toBeUndefined()
    expect(initialized.method).toBe("notifications/initialized")
    expect(initialized.body).not.toHaveProperty("id")
    expect(list.method).toBe("tools/list")
    expect(list.headers["mcp-session-id"]).toBe("session-1")
    expect(list.headers["mcp-protocol-version"]).toBe(
      MCP_LATEST_PROTOCOL_VERSION
    )
    expect(list.headers.authorization).toBe("Bearer secret-token")
    expect(list.headers.accept).toContain("text/event-stream")
  })

  it("refuses a server that answers with an unknown protocol version", async () => {
    const { client } = setup({ protocolVersion: "1999-01-01" })
    const error = await failure(() => client.listTools())
    expect(error.kind).toBe("unsupported_version")
  })

  it("accepts an older supported version and speaks it afterwards", async () => {
    const { server, client } = setup({ protocolVersion: "2025-03-26" })
    await client.listTools()
    expect(server.requests.at(-1)?.headers["mcp-protocol-version"]).toBe(
      "2025-03-26"
    )
  })

  it("reports refused credentials as unauthorized and undelivered", async () => {
    const { client } = setup({ requireToken: "other" })
    const error = await failure(() => client.listTools())
    expect(error).toMatchObject({ kind: "unauthorized", delivery: "no" })
    expect(error.message).not.toContain("secret-token")
  })
})

describe("McpClient responses", () => {
  it("reads an SSE reply split across chunks and declines interleaved server requests", async () => {
    const { server, client } = setup({ respondWith: "sse" })
    server.interleaveServerRequest({
      jsonrpc: "2.0",
      id: "srv-1",
      method: "sampling/createMessage",
      params: {}
    })
    const tools = await client.listTools()
    expect(tools.map((tool) => tool.name)).toEqual(["send", "search"])
    await Promise.resolve()
    const decline = server.requests.find(
      (request) => request.body?.id === "srv-1"
    )
    expect(decline?.body).toMatchObject({ error: { code: -32601 } })
  })

  it("follows tools/list pagination", async () => {
    const { client } = setup({
      pageSize: 1,
      tools: [{ name: "a" }, { name: "b" }, { name: "c" }]
    })
    expect((await client.listTools()).map((tool) => tool.name)).toEqual([
      "a",
      "b",
      "c"
    ])
  })

  it("keeps a JSON-RPC error as an undelivered rpc_error", async () => {
    const { client } = setup()
    const error = await failure(() => client.callTool("missing", {}))
    expect(error).toMatchObject({ kind: "rpc_error", delivery: "no" })
    expect(error.code).toBe(-32602)
  })
})

describe("McpClient delivery and replay", () => {
  it("is not ready until the initialized notification is accepted, and retries the handshake", async () => {
    const { server, client } = setup()
    server.failNextNotification(503)
    const first = await failure(() => client.listTools())
    expect(first.kind).toBe("server_error")
    expect(
      server.requests.some((request) => request.method === "tools/list")
    ).toBe(false)

    await client.listTools()
    const methods = server.requests.map((request) => request.method)
    expect(methods.filter((method) => method === "initialize")).toHaveLength(2)
    expect(methods.at(-1)).toBe("tools/list")
  })

  it("treats an internal server error from a tool as possibly delivered", async () => {
    const { client } = setup({
      tools: [
        {
          name: "send",
          run: () => {
            throw new Error("mail server exploded after sending")
          }
        }
      ]
    })
    const error = await failure(() => client.callTool("send", {}))
    expect(error).toMatchObject({
      kind: "rpc_error",
      code: -32603,
      delivery: "unknown"
    })
  })

  it("re-initializes after an expired session and runs the call exactly once", async () => {
    const { server, client } = setup()
    await client.ensureInitialized()
    server.expireSession()

    const output = await client.callTool("send", { to: "a@example.com" })

    expect(output.text).toBe("ran send")
    expect(server.executions).toHaveLength(1)
    expect(
      server.requests.filter((request) => request.method === "initialize")
    ).toHaveLength(2)
  })

  it("marks a server failure after the tool ran as possibly delivered and does not retry", async () => {
    const { server, client } = setup()
    server.failNextCallAfterRun(502)
    const error = await failure(() => client.callTool("send", {}))
    expect(error).toMatchObject({ kind: "server_error", delivery: "unknown" })
    expect(server.executions).toHaveLength(1)
  })

  it("times out a hung request as possibly delivered", async () => {
    const { server, client } = setup({}, 20)
    await client.ensureInitialized()
    server.hangForever()
    const error = await failure(() => client.callTool("send", {}))
    expect(error).toMatchObject({ kind: "timeout", delivery: "unknown" })
  })

  it("does not send anything when the caller has already cancelled", async () => {
    const { server, client } = setup()
    await client.ensureInitialized()
    const sent = server.requests.length
    const controller = new AbortController()
    controller.abort()
    const error = await failure(() =>
      client.callTool("send", {}, controller.signal)
    )
    expect(error).toMatchObject({ kind: "aborted", delivery: "no" })
    expect(server.requests).toHaveLength(sent)
  })

  it("ends the session with DELETE on close", async () => {
    const { server, client } = setup()
    await client.ensureInitialized()
    await client.close()
    const last = server.requests.at(-1)
    expect(last?.httpMethod).toBe("DELETE")
    expect(last?.headers["mcp-session-id"]).toBe("session-1")
    expect(last?.headers["mcp-protocol-version"]).toBe(
      MCP_LATEST_PROTOCOL_VERSION
    )
  })
})
