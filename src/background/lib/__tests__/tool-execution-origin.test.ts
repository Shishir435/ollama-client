import { beforeEach, describe, expect, it, vi } from "vitest"

const grantStore = vi.hoisted(() => new Map<string, unknown>())

vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: vi.fn(async (key: string) => grantStore.get(key)),
  setPlasmoStoredValue: vi.fn(async (key: string, value: unknown) => {
    grantStore.set(key, value)
  })
}))

import { ToolRegistry } from "@/lib/tools"
import { addAlwaysGrant } from "@/lib/tools/approval/approval-grants"
import type { ToolContext, ToolDefinition, ToolResult } from "@/lib/tools/types"
import { prepareToolCall, runPreparedToolCall } from "../tool-execution"
import { addSessionGrant, clearSessionGrants } from "../tool-session-grants"

const registryWith = (definition: ToolDefinition) => {
  const reg = new ToolRegistry()
  reg.register({
    id: "test",
    listTools: () => [definition],
    callTool: async (): Promise<ToolResult> => ({ content: "ok" })
  })
  return reg
}

const scopedDef = (
  resolver: ToolDefinition["grantScopeResolver"]
): ToolDefinition => ({
  name: "site_tool",
  description: "",
  parameters: { type: "object", properties: {} },
  risk: "high",
  grantScopeResolver: resolver
})

const call = { id: "c1", name: "site_tool", arguments: {} }

describe("prepareToolCall origin scoping", () => {
  beforeEach(() => {
    grantStore.clear()
    clearSessionGrants()
  })

  it("resolves the origin from the definition and records it on the run", async () => {
    const registry = registryWith(scopedDef(() => "https://github.com"))
    const prepared = await prepareToolCall(registry, call, undefined, {
      sessionId: "s1"
    })

    expect(prepared.origin).toBe("https://github.com")
    expect(prepared.originScoped).toBe(true)
    expect(prepared.run.origin).toBe("https://github.com")
    expect(prepared.requiresConfirmation).toBe(true)
  })

  it("honors a grant persisted for the same origin", async () => {
    await addAlwaysGrant("site_tool", "https://github.com")
    const registry = registryWith(scopedDef(() => "https://github.com"))

    const prepared = await prepareToolCall(registry, call, undefined, {
      sessionId: "s1"
    })
    expect(prepared.requiresConfirmation).toBe(false)
  })

  it("ignores a legacy wildcard grant for an origin-scoped tool", async () => {
    await addAlwaysGrant("site_tool") // wildcard "*"
    const registry = registryWith(scopedDef(() => "https://github.com"))

    const prepared = await prepareToolCall(registry, call, undefined, {
      sessionId: "s1"
    })
    expect(prepared.requiresConfirmation).toBe(true)
  })

  it("ignores a grant for a different origin", async () => {
    await addAlwaysGrant("site_tool", "https://github.com")
    addSessionGrant("s1", "site_tool", "https://github.com")
    const registry = registryWith(scopedDef(() => "https://evil.example"))

    const prepared = await prepareToolCall(registry, call, undefined, {
      sessionId: "s1"
    })
    expect(prepared.requiresConfirmation).toBe(true)
  })

  it("fails closed when the resolver throws or returns nothing", async () => {
    await addAlwaysGrant("site_tool") // wildcard must not apply either way
    for (const resolver of [
      () => {
        throw new Error("no tab")
      },
      () => undefined
    ] as const) {
      const registry = registryWith(scopedDef(resolver))
      const prepared = await prepareToolCall(registry, call, undefined, {
        sessionId: "s1"
      })
      expect(prepared.origin).toBeUndefined()
      expect(prepared.originScoped).toBe(true)
      expect(prepared.requiresConfirmation).toBe(true)
    }
  })

  it("hands the tool the origin its grant was resolved against", async () => {
    await addAlwaysGrant("site_tool", "https://github.com")
    const seen: ToolContext[] = []
    const reg = new ToolRegistry()
    reg.register({
      id: "test",
      listTools: () => [scopedDef(() => "https://github.com")],
      callTool: async (_name, _args, ctx): Promise<ToolResult> => {
        seen.push(ctx)
        return { content: "ok" }
      }
    })

    const prepared = await prepareToolCall(reg, call, undefined, {
      sessionId: "s1"
    })
    expect(prepared.requiresConfirmation).toBe(false)
    await runPreparedToolCall(prepared, reg, { sessionId: "s1" })

    // The tool re-verifies its actual target against this approved origin.
    expect(seen[0]?.approvedOrigin).toBe("https://github.com")
  })

  it("keeps wildcard semantics for tools without a resolver", async () => {
    const definition: ToolDefinition = {
      name: "site_tool",
      description: "",
      parameters: { type: "object", properties: {} },
      risk: "high"
    }
    await addAlwaysGrant("site_tool")

    const prepared = await prepareToolCall(
      registryWith(definition),
      call,
      undefined,
      { sessionId: "s1" }
    )
    expect(prepared.originScoped).toBe(false)
    expect(prepared.requiresConfirmation).toBe(false)
  })
})
