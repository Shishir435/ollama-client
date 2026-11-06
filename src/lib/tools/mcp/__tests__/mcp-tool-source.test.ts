import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/storage/setting-access", () => ({
  readSetting: vi.fn(),
  writeSetting: vi.fn(),
  removeSetting: vi.fn()
}))

import { readSetting } from "@/lib/storage/setting-access"
import { createMcpToolSource } from "../mcp-tool-source"
import type { McpServer } from "../types"

const wordcraft: McpServer = {
  id: "s1",
  name: "WordCraft",
  url: "http://localhost:9000/mcp",
  enabled: true
}

type FetchResponse = {
  ok: boolean
  status?: number
  contentType: string
  body: string
}

/** Stateful fetch mock keyed by JSON-RPC method, in call order. */
const queue: Record<string, FetchResponse[]> = {}
function respond(method: string, ...responses: FetchResponse[]) {
  queue[method] = responses
}
function json(body: Record<string, unknown>): FetchResponse {
  return {
    ok: true,
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body })
  }
}

vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
  const req = JSON.parse(init.body as string)
  const list = queue[req.method] ?? []
  const next = list.shift() ?? {
    ok: false,
    status: 503,
    contentType: "application/json",
    body: "boom"
  }
  let responseBody = next.body
  if (next.ok && next.contentType === "application/json") {
    const parsed = JSON.parse(responseBody) as Record<string, unknown>
    parsed.id = req.id
    responseBody = JSON.stringify(parsed)
  }
  return {
    ok: next.ok,
    status: next.status ?? 200,
    headers: new Headers({ "content-type": next.contentType }),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(responseBody))
        controller.close()
      }
    })
  }
})

describe("McpToolSource", () => {
  it("lists tools from every enabled server with prefixed names and safe defaults", async () => {
    respond(
      "initialize",
      json({
        result: { server: { name: "WordCraft" }, protocolVersion: "2025-03-31" }
      })
    )
    respond(
      "tools/list",
      json({
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
            },
            { name: "save_document", description: "Save the active document" }
          ]
        }
      })
    )
    vi.mocked(readSetting).mockResolvedValue([wordcraft])

    const source = createMcpToolSource()
    const defs = await source.listTools()
    expect(defs.map((d) => d.name)).toEqual([
      "wordcraft_open_document",
      "wordcraft_save_document"
    ])
    const [d] = defs
    expect(d.description).toBe("Open a file")
    expect(d.category).toBe("external")
    expect(d.risk).toBe("medium")
    expect(d.resultProvenance).toBe("web-untrusted")
    expect(
      (d.parameters as { properties: Record<string, unknown> }).properties.path
    ).toBeDefined()
  })

  it("skips disabled servers and survives a failing server", async () => {
    respond(
      "initialize",
      json({
        result: { server: { name: "WordCraft" }, protocolVersion: "2025-03-31" }
      })
    )
    respond(
      "tools/list",
      json({
        result: {
          tools: [{ name: "open_document", description: "Open a file" }]
        }
      })
    )
    vi.mocked(readSetting).mockResolvedValue([
      wordcraft,
      {
        ...wordcraft,
        id: "s2",
        name: "MailCraft",
        url: "http://localhost:9001/mcp",
        enabled: false
      },
      {
        ...wordcraft,
        id: "s3",
        name: "Broken",
        url: "http://localhost:9002/mcp"
      }
    ])

    const source = createMcpToolSource()
    const defs = await source.listTools()
    expect(defs.map((d) => d.name)).toEqual(["wordcraft_open_document"])
  })

  it("routes a call to the owning server with the raw tool name", async () => {
    respond(
      "initialize",
      json({
        result: { server: { name: "WordCraft" }, protocolVersion: "2025-03-31" }
      })
    )
    respond(
      "tools/list",
      json({ result: { tools: [{ name: "open_document" }] } })
    )
    respond(
      "tools/call",
      json({ result: { content: [{ type: "text", text: "Opened /a.docx" }] } })
    )
    vi.mocked(readSetting).mockResolvedValue([wordcraft])

    const source = createMcpToolSource()
    await source.listTools()
    const result = await source.callTool(
      "wordcraft_open_document",
      { path: "/a.docx" },
      {}
    )
    expect(result.content).toBe("Opened /a.docx")
  })

  it("returns an error result for a tool no server owns (never throws)", async () => {
    respond(
      "initialize",
      json({
        result: { server: { name: "WordCraft" }, protocolVersion: "2025-03-31" }
      })
    )
    respond(
      "tools/list",
      json({ result: { tools: [{ name: "open_document" }] } })
    )
    vi.mocked(readSetting).mockResolvedValue([wordcraft])

    const source = createMcpToolSource()
    await source.listTools()
    const result = await source.callTool("ghost_tool", {}, {})
    expect(result.isError).toBe(true)
    expect(result.content).toContain("Unknown MCP tool")
  })

  it("retries once after a connection error, then reports the failure when the retry also fails", async () => {
    respond(
      "initialize",
      json({
        result: { server: { name: "WordCraft" }, protocolVersion: "2025-03-31" }
      })
    )
    respond(
      "tools/list",
      json({ result: { tools: [{ name: "open_document" }] } })
    )
    respond(
      "tools/call",
      { ok: false, status: 503, contentType: "application/json", body: "boom" },
      {
        ok: false,
        status: 503,
        contentType: "application/json",
        body: "still down"
      }
    )
    vi.mocked(readSetting).mockResolvedValue([wordcraft])

    const source = createMcpToolSource()
    await source.listTools()
    const result = await source.callTool(
      "wordcraft_open_document",
      { path: "/a.docx" },
      {}
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain("failed")
  })

  it("recovers when the retry succeeds after a connection error", async () => {
    respond(
      "initialize",
      json({
        result: { server: { name: "WordCraft" }, protocolVersion: "2025-03-31" }
      }),
      json({
        result: { server: { name: "WordCraft" }, protocolVersion: "2025-03-31" }
      })
    )
    respond(
      "tools/list",
      json({ result: { tools: [{ name: "open_document" }] } })
    )
    respond(
      "tools/call",
      { ok: false, status: 503, contentType: "application/json", body: "boom" },
      json({ result: { content: [{ type: "text", text: "Recovered" }] } })
    )
    vi.mocked(readSetting).mockResolvedValue([wordcraft])

    const source = createMcpToolSource()
    await source.listTools()
    const result = await source.callTool(
      "wordcraft_open_document",
      { path: "/a.docx" },
      {}
    )
    expect(result.isError).toBe(false)
    expect(result.content).toBe("Recovered")
  })
})
