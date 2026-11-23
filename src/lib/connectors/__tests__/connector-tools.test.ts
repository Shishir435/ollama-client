/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/browser-api", () => ({
  browser: { runtime: { getManifest: () => ({ version: "0.16.0" }) } }
}))

import { getToolFamily } from "@/lib/tools/tool-families"
import { ConnectorClientPool } from "../connector-clients"
import {
  effectiveConnectorRisk,
  suggestedConnectorRisk
} from "../connector-risk"
import { buildConnectorToolIndex, connectorSlug } from "../connector-tool-index"
import { createConnectorToolSource } from "../connector-tool-source"
import {
  MAX_TOOL_SCHEMA_CHARS,
  type StoredConnector,
  type StoredConnectorTool
} from "../types"
import { createFakeMcpServer } from "./fake-mcp-server"

const tool = (
  name: string,
  overrides: Partial<StoredConnectorTool> = {}
): StoredConnectorTool => ({
  name,
  inputSchema: { type: "object", properties: {} },
  enabled: true,
  ...overrides
})

const connector = (
  overrides: Partial<StoredConnector> = {}
): StoredConnector => ({
  id: "c_mail",
  type: "mcp-local",
  name: "Mail",
  url: "http://127.0.0.1:8086/mcp/mail",
  enabled: true,
  auth: { kind: "bearer", secret: "secret-token" },
  status: "ok",
  tools: [tool("send"), tool("search")],
  ...overrides
})

describe("connector risk", () => {
  it("lets only a read-only, non-destructive hint lower the default", () => {
    expect(suggestedConnectorRisk(undefined)).toBe("high")
    expect(suggestedConnectorRisk({ readOnlyHint: true })).toBe("medium")
    expect(
      suggestedConnectorRisk({ readOnlyHint: true, destructiveHint: true })
    ).toBe("high")
    expect(suggestedConnectorRisk({ destructiveHint: false })).toBe("high")
  })

  it("lets the user's override win", () => {
    expect(
      effectiveConnectorRisk({
        annotations: { readOnlyHint: true },
        riskOverride: "critical"
      })
    ).toBe("critical")
  })
})

describe("buildConnectorToolIndex", () => {
  it("prefixes names, keeps them provider-safe and skips disabled tools and connectors", () => {
    const entries = buildConnectorToolIndex([
      connector({
        tools: [
          tool("send"),
          tool("draft.reply/v2"),
          tool("off", { enabled: false })
        ]
      }),
      connector({ id: "c_off", name: "Off", enabled: false })
    ])
    const names = entries.map((entry) => entry.definition.name)
    expect(names[0]).toBe("mail_send")
    expect(names[1]).toMatch(/^mail_draft_reply_v2_[0-9][0-9a-z]{5}$/)
    expect(names).toHaveLength(2)
    for (const entry of entries) {
      expect(entry.definition.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
      expect(entry.definition.resultProvenance).toBe("web-untrusted")
      expect(getToolFamily(entry.definition)).toBe("connectors")
    }
  })

  it("never hands one server's tool name to another when a connector is turned off or removed", () => {
    const nameOf = (list: StoredConnector[], id: string, tool: string) =>
      buildConnectorToolIndex(list).find(
        (entry) => entry.connector.id === id && entry.tool.name === tool
      )?.definition.name
    const a = connector({ id: "a" })
    const b = connector({ id: "b" })

    const aSend = nameOf([a, b], "a", "send")
    const bSend = nameOf([a, b], "b", "send")
    expect(aSend).toMatch(/^mail_send_[0-9][0-9a-z]{5}$/)
    expect(bSend).toMatch(/^mail_send_[0-9][0-9a-z]{5}$/)
    expect(aSend).not.toBe(bSend)

    /** Turning A off keeps B's name: collisions count disabled connectors. */
    expect(nameOf([{ ...a, enabled: false }, b], "b", "send")).toBe(bSend)
    /** Removing A gives B a new name, never A's old one. */
    const bAlone = nameOf([b], "b", "send")
    expect(bAlone).toBe("mail_send")
    expect(bAlone).not.toBe(aSend)
  })

  it("keeps clear of built-in tool names", () => {
    const [entry] = buildConnectorToolIndex(
      [connector({ name: "Web", tools: [tool("search")] })],
      new Set(["web_search"])
    )
    expect(entry.definition.name).toMatch(/^web_search_[0-9][0-9a-z]{5}$/)
  })

  it("never gives a clean tool name another tool's tagged name", () => {
    const [dotted] = buildConnectorToolIndex([
      connector({ tools: [tool("a.b")] })
    ])
    const tagged = dotted.definition.name
    const lookalike = tagged.slice("mail_".length)
    /** After a refresh, the server offers a clean tool spelled like that tag. */
    const [clean] = buildConnectorToolIndex([
      connector({ tools: [tool(lookalike)] })
    ])
    expect(clean.definition.name).not.toBe(tagged)
    expect(clean.definition.name).toMatch(/_[0-9][0-9a-z]{5}_[0-9][0-9a-z]{5}$/)
  })

  it("tags every name that had to be sanitized, so a renamed tool never inherits it", () => {
    const nameFor = (tools: StoredConnectorTool[]) =>
      buildConnectorToolIndex([connector({ tools })]).map(
        (entry) => entry.definition.name
      )
    const [dotted] = nameFor([tool("a.b")])
    const [clean] = nameFor([tool("a_b")])
    expect(dotted).toMatch(/^mail_a_b_[0-9][0-9a-z]{5}$/)
    expect(clean).toBe("mail_a_b")
    expect(dotted).not.toBe(clean)
    expect(new Set(nameFor([tool("a.b"), tool("a_b")])).size).toBe(2)
  })

  it("gives endpoints that differ only by query different approval scopes", () => {
    const scopeFor = (url: string) =>
      buildConnectorToolIndex([
        connector({ url })
      ])[0].definition.grantScopeResolver?.({}, {})
    const a = scopeFor("https://mcp.example/mcp?tenant=a")
    const b = scopeFor("https://mcp.example/mcp?tenant=b")
    expect(a).not.toBe(b)
    expect(scopeFor("https://mcp.example/mcp?tenant=a")).toBe(a)
    expect(String(a)).not.toContain("tenant")
  })

  it("binds approvals to the connector, not the tool name", () => {
    const [first] = buildConnectorToolIndex([connector({ id: "a" })])
    const [second] = buildConnectorToolIndex([connector({ id: "b" })])
    expect(first.definition.name).toBe(second.definition.name)
    const scope = (entry: typeof first) =>
      entry.definition.grantScopeResolver?.({}, {})
    expect(scope(first)).toBe("http://127.0.0.1:8086/mcp/mail#a/send")
    expect(scope(first)).not.toBe(scope(second))
  })

  it("passes nested schemas through and drops an oversized one", () => {
    const nested = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { to: { $ref: "#/$defs/address" } },
      required: ["to"],
      $defs: { address: { type: "string", format: "email" } }
    }
    const [entry, ...rest] = buildConnectorToolIndex([
      connector({
        tools: [
          tool("send", { inputSchema: nested }),
          tool("huge", {
            inputSchema: {
              type: "object",
              description: "x".repeat(MAX_TOOL_SCHEMA_CHARS)
            }
          })
        ]
      })
    ])
    expect(rest).toHaveLength(0)
    expect(entry.definition.parameters).toEqual({
      type: "object",
      properties: { to: { $ref: "#/$defs/address" } },
      required: ["to"],
      $defs: { address: { type: "string", format: "email" } }
    })
  })

  it("slugs any connector name into a non-empty prefix", () => {
    expect(connectorSlug("My Mail Server!")).toBe("my_mail_server")
    expect(connectorSlug("日本語")).toBe("connector")
  })
})

describe("connector tool source", () => {
  const sourceFor = (
    stored: StoredConnector,
    server: ReturnType<typeof createFakeMcpServer>
  ) =>
    createConnectorToolSource({
      read: async () => [stored],
      clients: async () => new ConnectorClientPool(server.fetch)
    })

  let server: ReturnType<typeof createFakeMcpServer>
  beforeEach(() => {
    server = createFakeMcpServer({
      tools: [
        {
          name: "send",
          run: (args) => ({
            content: [{ type: "text", text: `sent to ${String(args.to)}` }]
          })
        },
        { name: "search" }
      ]
    })
  })

  it("routes a prefixed call to the raw tool name and marks the result untrusted", async () => {
    const source = sourceFor(connector(), server)
    const result = await source.callTool("mail_send", { to: "a@b.c" }, {})
    expect(result).toEqual({
      content: "sent to a@b.c",
      isError: false,
      provenance: "web-untrusted"
    })
    expect(server.executions).toEqual([{ name: "send", args: { to: "a@b.c" } }])
  })

  it("never replays a call whose outcome is unknown, and says so", async () => {
    const source = sourceFor(connector(), server)
    await source.callTool("mail_search", {}, {})
    server.failNextCallAfterRun(500)
    const result = await source.callTool("mail_send", { to: "a@b.c" }, {})
    expect(result.isError).toBe(true)
    expect(result.content).toContain("may already have run")
    expect(
      server.executions.filter((execution) => execution.name === "send")
    ).toHaveLength(1)
  })

  it("says a tool did not run when the connector cannot be reached", async () => {
    const source = createConnectorToolSource({
      read: async () => [connector()],
      clients: async () =>
        new ConnectorClientPool(async () => {
          throw new TypeError("Failed to fetch")
        })
    })
    const result = await source.callTool("mail_send", {}, {})
    expect(result.isError).toBe(true)
    expect(result.content).toContain("did not run")
    expect(result.content).not.toContain("secret-token")
    expect(result.content).not.toContain("127.0.0.1")
  })

  it("refuses a tool the user has turned off since the list was built", async () => {
    const source = sourceFor(
      connector({ tools: [tool("send", { enabled: false })] }),
      server
    )
    const result = await source.callTool("mail_send", {}, {})
    expect(result.isError).toBe(true)
    expect(server.executions).toHaveLength(0)
  })

  it("strips the connector's token and URL from a server's error text", async () => {
    const echoing = createFakeMcpServer({
      tools: [
        {
          name: "send",
          run: () => {
            throw new Error(
              "auth Bearer secret-token failed for http://127.0.0.1:8086/mcp/mail"
            )
          }
        }
      ]
    })
    const result = await sourceFor(connector(), echoing).callTool(
      "mail_send",
      {},
      {}
    )
    expect(result.isError).toBe(true)
    expect(result.content).not.toContain("secret-token")
    expect(result.content).not.toContain("127.0.0.1:8086/mcp/mail")
    expect(result.content).toContain("[redacted]")
  })

  it("redacts the connector's token from a server-reported tool error result", async () => {
    const echoing = createFakeMcpServer({
      tools: [
        {
          name: "send",
          run: () => ({
            content: [{ type: "text", text: "denied for token secret-token" }],
            isError: true
          })
        }
      ]
    })
    const result = await sourceFor(connector(), echoing).callTool(
      "mail_send",
      {},
      {}
    )
    expect(result.isError).toBe(true)
    expect(result.content).toBe("denied for token [redacted]")
  })

  it("redacts even a very short token", async () => {
    const echoing = createFakeMcpServer({
      tools: [
        {
          name: "send",
          run: () => ({ content: [{ type: "text", text: "key=q9" }] })
        }
      ]
    })
    const result = await sourceFor(
      connector({ auth: { kind: "bearer", secret: "q9" } }),
      echoing
    ).callTool("mail_send", {}, {})
    expect(result.content).toBe("key=[redacted]")
  })

  it("refuses a call approved for a different connector behind the same name", async () => {
    const source = sourceFor(connector({ id: "new" }), server)
    const result = await source.callTool(
      "mail_send",
      {},
      { approvedOrigin: "http://127.0.0.1:8086/mcp/mail#old/send" }
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain("changed after it was approved")
    expect(server.executions).toHaveLength(0)
  })

  it("refuses an approved call whose approval named a different tool", async () => {
    const stored = connector()
    const [send] = buildConnectorToolIndex([stored])
    const approvedOrigin = await send.definition.grantScopeResolver?.({}, {})
    const source = sourceFor(stored, server)
    expect(
      (await source.callTool("mail_send", { to: "a@b.c" }, { approvedOrigin }))
        .isError
    ).toBe(false)
    const forOther = String(approvedOrigin).replace(/\/send$/, "/search")
    const refused = await source.callTool(
      "mail_send",
      {},
      { approvedOrigin: forOther }
    )
    expect(refused.isError).toBe(true)
    expect(server.executions).toHaveLength(1)
  })

  it("lists from storage without touching the network", async () => {
    const source = sourceFor(connector(), server)
    const listed = await source.listTools()
    expect(listed.map((definition) => definition.name)).toEqual([
      "mail_send",
      "mail_search"
    ])
    expect(server.requests).toHaveLength(0)
  })
})
