import { afterEach, describe, expect, it, vi } from "vitest"

import { discoverAgentPageTools, executeAgentPageTool } from "../page-tools"

const install = (context: unknown) => {
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: context
  })
}

afterEach(() => {
  Reflect.deleteProperty(document, "modelContext")
})

describe("WebMCP page tools", () => {
  it("feature-detects absence without failing ordinary DOM control", async () => {
    await expect(
      discoverAgentPageTools({ document, frameId: 0, documentId: "doc-1" })
    ).resolves.toEqual([])
  })

  it("bounds and binds discovered descriptors to one document revision", async () => {
    install({
      getTools: vi.fn().mockResolvedValue([
        {
          name: "addTodo",
          description: "Add one item",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } }
          },
          annotations: { readOnlyHint: false, consequentialHint: true }
        }
      ])
    })

    const [tool] = await discoverAgentPageTools({
      document,
      frameId: 0,
      documentId: "doc-1"
    })

    expect(tool).toMatchObject({
      name: "addTodo",
      frameId: 0,
      documentId: "doc-1",
      annotations: { readOnlyHint: false, consequentialHint: true }
    })
    expect(tool.schemaRevision).toMatch(/^[0-9a-f]{8}$/)
  })

  it("refuses a changed schema before invoking page code", async () => {
    const executeTool = vi.fn()
    install({
      getTools: vi.fn().mockResolvedValue([
        {
          name: "save",
          description: "Changed description",
          inputSchema: { type: "object" }
        }
      ]),
      executeTool
    })

    await expect(
      executeAgentPageTool({
        document,
        frameId: 0,
        documentId: "doc-1",
        name: "save",
        schemaRevision: "00000000",
        args: {}
      })
    ).resolves.toEqual({ type: "stale" })
    expect(executeTool).not.toHaveBeenCalled()
  })

  it("forwards cancellation and treats null as browser-reported navigation", async () => {
    let receivedSignal: AbortSignal | undefined
    const tool = {
      name: "openItem",
      description: "Open an item",
      inputSchema: { type: "object" }
    }
    const context = {
      getTools: vi.fn().mockResolvedValue([tool]),
      executeTool: vi.fn(
        async (
          _tool: unknown,
          _args: unknown,
          options: { signal: AbortSignal }
        ) => {
          receivedSignal = options.signal
          return null
        }
      )
    }
    install(context)
    const [advertised] = await discoverAgentPageTools({
      document,
      frameId: 0,
      documentId: "doc-1"
    })
    const controller = new AbortController()

    await expect(
      executeAgentPageTool({
        document,
        frameId: 0,
        documentId: "doc-1",
        name: tool.name,
        schemaRevision: advertised.schemaRevision,
        args: {},
        signal: controller.signal
      })
    ).resolves.toEqual({ type: "executed", result: "", navigation: true })
    expect(receivedSignal).toBe(controller.signal)
  })
})
