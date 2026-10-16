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
  beforeEach(async () => {
    grantStore.clear()
    await clearSessionGrants()
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

  it("ignores persisted and earlier-session grants after untrusted input", async () => {
    await addAlwaysGrant("site_tool", "https://github.com")
    await addSessionGrant("s1", "site_tool", {
      origin: "https://github.com",
      taintGeneration: 0
    })
    const registry = registryWith(scopedDef(() => "https://github.com"))

    const prepared = await prepareToolCall(registry, call, undefined, {
      sessionId: "s1",
      taintGeneration: 1
    })

    expect(prepared.run.taintGeneration).toBe(1)
    expect(prepared.requiresConfirmation).toBe(true)
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
    await addSessionGrant("s1", "site_tool", { origin: "https://github.com" })
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

describe("a call's own confirmation demand", () => {
  beforeEach(async () => {
    grantStore.clear()
    await clearSessionGrants()
  })

  const demanding = (
    confirmation: ToolDefinition["confirmation"],
    risk: ToolDefinition["risk"] = "medium"
  ): ToolDefinition => ({
    ...scopedDef(() => "https://github.com"),
    risk,
    confirmation
  })

  it("asks despite a grant when the call demands it, and shows what it said", async () => {
    await addSessionGrant("s1", "site_tool", {
      origin: "https://github.com",
      taintGeneration: 0
    })
    const registry = registryWith(
      demanding(() => ({
        always: true,
        summary: "Open the pricing page",
        notes: ["agent.start_gate.after_page"]
      }))
    )

    const prepared = await prepareToolCall(registry, call, undefined, {
      sessionId: "s1"
    })

    expect(prepared.requiresConfirmation).toBe(true)
    expect(prepared.run.confirmationSummary).toBe("Open the pricing page")
    expect(prepared.run.confirmationNotes).toEqual([
      "agent.start_gate.after_page"
    ])
  })

  it("lets the grant stand when the call does not demand more", async () => {
    await addSessionGrant("s1", "site_tool", {
      origin: "https://github.com",
      taintGeneration: 0
    })
    const registry = registryWith(demanding(() => ({ always: false })))

    const prepared = await prepareToolCall(registry, call, undefined, {
      sessionId: "s1"
    })

    expect(prepared.requiresConfirmation).toBe(false)
  })

  it("never asks about a low-risk call because of a demand", async () => {
    const confirmation = vi.fn(() => ({ always: true }))
    const registry = registryWith(demanding(confirmation, "low"))

    const prepared = await prepareToolCall(registry, call)

    expect(prepared.requiresConfirmation).toBe(false)
    expect(confirmation).not.toHaveBeenCalled()
  })

  it("tells the tool the user approved this very call", async () => {
    const seen: ToolContext[] = []
    const reg = new ToolRegistry()
    const definition = demanding(() => ({
      always: true,
      notes: ["agent.start_gate.routine"]
    }))
    reg.register({
      id: "test",
      listTools: () => [definition],
      callTool: async (_name, _args, ctx): Promise<ToolResult> => {
        seen.push(ctx)
        return { content: "ok" }
      }
    })
    const prepared = await prepareToolCall(reg, call, undefined, {
      sessionId: "s1"
    })
    const confirmations = await import("../tool-confirmation-registry")
    const running = runPreparedToolCall(prepared, reg, { sessionId: "s1" })
    confirmations.resolveToolConfirmation("c1", true)
    await running

    expect(seen[0]?.userConfirmed).toBe(true)
    expect(seen[0]?.confirmedNotes).toEqual(["agent.start_gate.routine"])
    expect(seen[0]?.toolCallId).toBe("c1")
  })
})

describe("a tool whose chat grant is the chat itself", () => {
  beforeEach(async () => {
    grantStore.clear()
    await clearSessionGrants()
  })

  const chatTool = (
    confirmation?: ToolDefinition["confirmation"]
  ): ToolDefinition => ({
    ...scopedDef(() => "https://other.example"),
    sessionGrantScope: "chat",
    ...(confirmation ? { confirmation } : {})
  })

  it("is covered on a new site and after a page read once allowed for the chat", async () => {
    await addSessionGrant("s1", "site_tool", { chat: true })
    const prepared = await prepareToolCall(
      registryWith(chatTool()),
      call,
      undefined,
      { sessionId: "s1", taintGeneration: 2 }
    )
    expect(prepared.requiresConfirmation).toBe(false)
    expect(prepared.chatScopedGrant).toBe(true)
  })

  it("still asks when the call demands it", async () => {
    await addSessionGrant("s1", "site_tool", { chat: true })
    const prepared = await prepareToolCall(
      registryWith(chatTool(() => ({ always: true }))),
      call,
      undefined,
      { sessionId: "s1" }
    )
    expect(prepared.requiresConfirmation).toBe(true)
  })
})
