import { describe, expect, it, vi } from "vitest"

import { McpClient, McpConnectionError } from "../mcp-client"
import type { McpServer } from "../types"

const testServer: McpServer = {
  id: "s1",
  name: "WordCraft",
  url: "http://localhost:9000/mcp",
  enabled: true
}

const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`

describe("McpClient", () => {
  it("parses an SSE response and returns the result for our request id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "text/event-stream" }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              sse({
                jsonrpc: "2.0",
                id: 1,
                result: {
                  server: { name: "WordCraft" },
                  protocolVersion: "2025-03-31"
                }
              })
            )
          )
          controller.close()
        }
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const client = new McpClient(testServer)
    const info = await client.initialize()
    expect(info).toEqual({ name: "WordCraft", protocolVersion: "2025-03-31" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("parses a plain JSON body response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                result: {
                  tools: [
                    {
                      name: "open_document",
                      description: "Open a file",
                      inputSchema: {
                        type: "object",
                        properties: { path: {} },
                        required: ["path"]
                      }
                    }
                  ]
                }
              })
            )
          )
          controller.close()
        }
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const client = new McpClient(testServer)
    const tools = await client.listTools()
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe("open_document")
  })

  it("returns tool content joined from the MCP content array", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                result: {
                  content: [
                    { type: "text", text: "Page 1" },
                    { type: "text", text: "Page 2" }
                  ]
                }
              })
            )
          )
          controller.close()
        }
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const client = new McpClient(testServer)
    expect(await client.callTool("open_document", { path: "/a.docx" })).toBe(
      "Page 1\nPage 2"
    )
  })

  it("throws McpConnectionError on an unreachable endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch"))
    vi.stubGlobal("fetch", fetchMock)

    const client = new McpClient(testServer)
    await expect(client.initialize()).rejects.toThrow(McpConnectionError)
  })

  it("throws McpConnectionError on a non-OK response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: new Headers({ "content-type": "application/json" }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("Service unavailable"))
          controller.close()
        }
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const client = new McpClient(testServer)
    await expect(client.initialize()).rejects.toThrow(/HTTP 503/)
  })

  it("surfaces a server-side JSON-RPC error as an Error with the message", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                error: { code: -32601, message: "method not found" }
              })
            )
          )
          controller.close()
        }
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const client = new McpClient(testServer)
    await expect(client.initialize()).rejects.toThrow(/method not found/)
  })

  it("times out when the response never arrives", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "text/event-stream" }),
      body: new ReadableStream({ start() {} }) // never closes
    })
    vi.stubGlobal("fetch", fetchMock)

    const client = new McpClient(testServer, 50)
    await expect(client.initialize()).rejects.toThrow(McpConnectionError)
  })

  it("respects an external abort signal", async () => {
    const controller = new AbortController()
    const signal = controller.signal
    const fetchMock = vi
      .fn()
      .mockImplementation((_: string, init?: RequestInit) => {
        return new Promise<never>((_, reject) => {
          if (init?.signal) {
            init.signal.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true }
            )
          }
        })
      })
    vi.stubGlobal("fetch", fetchMock)

    const client = new McpClient(testServer, 50_000)
    const promise = client.initialize(signal)
    controller.abort()
    await expect(promise).rejects.toThrow()
  })
})
