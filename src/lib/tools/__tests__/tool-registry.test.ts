import { describe, expect, it } from "vitest"

import { ToolRegistry } from "../tool-registry"
import type { ToolDefinition, ToolSource } from "../types"

const def = (name: string): ToolDefinition => ({
  name,
  description: name,
  parameters: { type: "object", properties: {} }
})

const source = (
  id: string,
  tools: ToolDefinition[],
  run?: ToolSource["callTool"]
): ToolSource => ({
  id,
  listTools: () => tools,
  callTool: run ?? (async (name) => ({ content: `${id}:${name}` }))
})

describe("ToolRegistry", () => {
  it("aggregates definitions across sources", async () => {
    const reg = new ToolRegistry()
    reg.register(source("a", [def("one")]))
    reg.register(source("b", [def("two")]))

    const names = (await reg.listDefinitions()).map((d) => d.name)
    expect(names).toEqual(["one", "two"])
  })

  it("drops duplicate names (first source wins) and routes to the winner", async () => {
    const reg = new ToolRegistry()
    reg.register(source("a", [def("dup")]))
    reg.register(source("b", [def("dup")]))

    expect(await reg.listDefinitions()).toHaveLength(1)
    expect((await reg.call("dup", {}, {})).content).toBe("a:dup")
  })

  it("skips tools with provider-invalid names", async () => {
    const reg = new ToolRegistry()
    reg.register(source("a", [def("bad name!"), def("ok_name")]))

    expect((await reg.listDefinitions()).map((d) => d.name)).toEqual([
      "ok_name"
    ])
  })

  it("returns an error result for an unknown tool (never throws)", async () => {
    const reg = new ToolRegistry()
    reg.register(source("a", [def("one")]))

    const result = await reg.call("missing", {}, {})
    expect(result.isError).toBe(true)
    expect(result.content).toContain("Unknown tool")
  })

  it("converts a throwing tool into an error result", async () => {
    const reg = new ToolRegistry()
    reg.register(
      source("a", [def("boom")], async () => {
        throw new Error("kaboom")
      })
    )

    const result = await reg.call("boom", {}, {})
    expect(result.isError).toBe(true)
    expect(result.content).toContain("kaboom")
  })

  it("survives a source that throws while listing", async () => {
    const reg = new ToolRegistry()
    reg.register({
      id: "bad",
      listTools: () => {
        throw new Error("list failed")
      },
      callTool: async () => ({ content: "" })
    })
    reg.register(source("good", [def("ok")]))

    expect((await reg.listDefinitions()).map((d) => d.name)).toEqual(["ok"])
  })

  it("returns a registered tool definition for metadata lookup", async () => {
    const reg = new ToolRegistry()
    reg.register(
      source("a", [
        { ...def("one"), displayNameKey: "tool.one", iconKey: "search" }
      ])
    )

    await reg.listDefinitions()
    expect(await reg.getDefinition("one")).toMatchObject({
      displayNameKey: "tool.one",
      iconKey: "search"
    })
  })

  it("invalidates cached definitions", async () => {
    let tools = [def("one")]
    const reg = new ToolRegistry()
    reg.register({
      id: "a",
      listTools: () => tools,
      callTool: async (name) => ({ content: `a:${name}` })
    })

    expect((await reg.listDefinitions()).map((d) => d.name)).toEqual(["one"])
    tools = [def("two")]
    reg.invalidate()
    expect((await reg.listDefinitions()).map((d) => d.name)).toEqual(["two"])
  })
})
