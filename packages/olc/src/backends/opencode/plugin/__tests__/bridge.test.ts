import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  jsonSchemaToZodShape: vi.fn(() => ({ converted: true })),
  readFileSync: vi.fn(),
  tool: Object.assign(
    vi.fn((definition) => definition),
    {
      schema: { string: vi.fn() }
    }
  )
}))

vi.mock("node:fs", () => ({
  default: { readFileSync: mocks.readFileSync }
}))

vi.mock("@opencode-ai/plugin", () => ({ tool: mocks.tool }))

vi.mock("../json-schema.js", () => ({
  jsonSchemaToZodShape: mocks.jsonSchemaToZodShape
}))

import { olcBridge } from "../bridge.js"

const manifest = (tools: unknown[]) =>
  JSON.stringify({
    endpoint: "http://127.0.0.1:4567/bridge",
    token: "secret",
    tools
  })

const context = {
  abort: new AbortController().signal,
  messageID: "message-1",
  sessionID: "session-1"
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("fetch", vi.fn())
})

describe("OpenCode client-tool bridge", () => {
  it("returns no tools when the manifest cannot be read", async () => {
    mocks.readFileSync.mockImplementationOnce(() => {
      throw new Error("missing")
    })

    await expect(olcBridge()).resolves.toEqual({ tool: {} })
  })

  it("registers named tools, skips invalid entries, and supplies defaults", async () => {
    mocks.readFileSync.mockReturnValueOnce(
      manifest([
        {
          name: "search",
          description: "Search documents",
          parameters: { type: "object" }
        },
        { name: "plain" },
        { description: "missing name" }
      ])
    )

    const result = (await olcBridge()) as {
      tool: Record<string, { args: unknown; description: string }>
    }

    expect(Object.keys(result.tool)).toEqual(["search", "plain"])
    expect(result.tool.search).toMatchObject({
      args: { converted: true },
      description: "Search documents"
    })
    expect(result.tool.plain.description).toBe("Client tool plain")
    expect(mocks.jsonSchemaToZodShape).toHaveBeenCalledTimes(2)
  })

  it("posts execution context and returns a string output", async () => {
    mocks.readFileSync.mockReturnValueOnce(manifest([{ name: "search" }]))
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ output: "found" }), { status: 200 })
    )
    const result = (await olcBridge()) as {
      tool: Record<
        string,
        { execute: (args: unknown, runtime: typeof context) => Promise<string> }
      >
    }

    await expect(
      result.tool.search.execute({ query: "llama" }, context)
    ).resolves.toBe("found")
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4567/bridge",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OLC-Token": "secret"
        },
        body: JSON.stringify({
          tool: "search",
          arguments: { query: "llama" },
          sessionID: "session-1",
          messageID: "message-1"
        }),
        signal: context.abort
      })
    )
  })

  it("serializes a non-string successful output", async () => {
    mocks.readFileSync.mockReturnValueOnce(manifest([{ name: "search" }]))
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ output: { hits: 2 } }), { status: 200 })
    )
    const result = (await olcBridge()) as {
      tool: Record<
        string,
        { execute: (args: unknown, runtime: typeof context) => Promise<string> }
      >
    }

    await expect(result.tool.search.execute(undefined, context)).resolves.toBe(
      JSON.stringify({ hits: 2 })
    )
  })

  it("surfaces the bridge's structured HTTP error", async () => {
    mocks.readFileSync.mockReturnValueOnce(manifest([{ name: "search" }]))
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "tool denied" }), { status: 403 })
    )
    const result = (await olcBridge()) as {
      tool: Record<
        string,
        { execute: (args: unknown, runtime: typeof context) => Promise<string> }
      >
    }

    await expect(result.tool.search.execute({}, context)).rejects.toThrow(
      "tool denied"
    )
  })

  it("uses the HTTP status when the error body is not JSON", async () => {
    mocks.readFileSync.mockReturnValueOnce(manifest([{ name: "search" }]))
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("bad gateway", { status: 502 })
    )
    const result = (await olcBridge()) as {
      tool: Record<
        string,
        { execute: (args: unknown, runtime: typeof context) => Promise<string> }
      >
    }

    await expect(result.tool.search.execute({}, context)).rejects.toThrow(
      "bridge returned HTTP 502"
    )
  })
})
