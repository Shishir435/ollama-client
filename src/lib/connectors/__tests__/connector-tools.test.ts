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
    expect(entries.map((entry) => entry.definition.name)).toEqual([
      "mail_send",
      "mail_draft_reply_v2"
    ])
    for (const entry of entries) {
      expect(entry.definition.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
      expect(entry.definition.resultProvenance).toBe("web-untrusted")
      expect(getToolFamily(entry.definition)).toBe("connectors")
    }
  })

  it("suffixes a collision between two connectors with the same name", () => {
    const names = buildConnectorToolIndex([
      connector({ id: "a" }),
      connector({ id: "b" })
    ]).map((entry) => entry.definition.name)
    expect(names).toEqual([
      "mail_send",
      "mail_search",
      "mail_send_2",
      "mail_search_2"
    ])
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
