/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest"

let stored: unknown
vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: async () => stored,
  setPlasmoStoredValue: async (_key: string, value: unknown) => {
    stored = JSON.parse(JSON.stringify(value))
  }
}))
vi.mock("@/lib/browser-api", () => ({
  browser: { runtime: { getManifest: () => ({ version: "0.16.0" }) } }
}))

import type { ConnectorDraft } from "@ollama-client/contracts/connector-rpc"
import { PublicConnectorSchema } from "@ollama-client/contracts/connector-rpc"
import { ConnectorClientPool } from "../connector-clients"
import { createConnectorService } from "../connector-service"
import { readConnectors } from "../connector-store"
import { createFakeMcpServer } from "./fake-mcp-server"

const draft = (overrides: Partial<ConnectorDraft> = {}): ConnectorDraft => ({
  type: "mcp-local",
  name: "Mail",
  url: "http://127.0.0.1:8086/mcp/mail",
  enabled: true,
  auth: { kind: "bearer" },
  secret: { state: "replaced", value: "secret-token" },
  ...overrides
})

let server: ReturnType<typeof createFakeMcpServer>
let service: ReturnType<typeof createConnectorService>

beforeEach(() => {
  stored = undefined
  server = createFakeMcpServer({
    requireToken: "secret-token",
    tools: [
      { name: "send", annotations: { destructiveHint: true } },
      { name: "search", annotations: { readOnlyHint: true } }
    ]
  })
  service = createConnectorService({
    clients: new ConnectorClientPool(server.fetch)
  })
})

describe("connector service", () => {
  it("never returns the credential, only that one is stored", async () => {
    const { connector } = await service.save(draft())
    expect(PublicConnectorSchema.parse(connector)).toEqual(connector)
    expect(JSON.stringify(connector)).not.toContain("secret-token")
    expect(connector.hasSecret).toBe(true)
    expect((await readConnectors())[0].auth.secret).toBe("secret-token")
  })

  it("discovers tools with suggested risks and keeps the user's choices on refresh", async () => {
    const { connector } = await service.save(draft())
    const first = await service.refresh(connector.id)
    expect(first.connector.status).toBe("ok")
    expect(first.connector.serverName).toBe("fake-server")
    expect(
      first.connector.tools.map((tool) => [tool.name, tool.suggestedRisk])
    ).toEqual([
      ["send", "high"],
      ["search", "medium"]
    ])

    await service.setTool({
      id: connector.id,
      toolName: "send",
      enabled: false
    })
    await service.setTool({
      id: connector.id,
      toolName: "search",
      riskOverride: "low"
    })
    const second = await service.refresh(connector.id)
    expect(second.connector.tools).toMatchObject([
      { name: "send", enabled: false },
      { name: "search", enabled: true, riskOverride: "low" }
    ])

    const cleared = await service.setTool({
      id: connector.id,
      toolName: "search",
      riskOverride: null
    })
    expect(cleared.connector.tools[1].riskOverride).toBeUndefined()
  })

  it("keeps the secret on an unchanged save and drops tools when the endpoint moves", async () => {
    const { connector } = await service.save(draft())
    await service.refresh(connector.id)

    const renamed = await service.save(
      draft({
        id: connector.id,
        name: "Work mail",
        secret: { state: "unchanged" }
      })
    )
    expect(renamed.connector.hasSecret).toBe(true)
    expect(renamed.connector.tools).toHaveLength(2)

    const moved = await service.save(
      draft({
        id: connector.id,
        url: "http://127.0.0.1:8086/mcp/other",
        secret: { state: "unchanged" }
      })
    )
    expect(moved.connector.tools).toHaveLength(0)
    expect(moved.connector.discoveredAt).toBeUndefined()
  })

  it("does not write discovery results onto a connector re-pointed during the refresh", async () => {
    const { connector } = await service.save(draft())
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let reachedList: () => void = () => undefined
    const listing = new Promise<void>((resolve) => {
      reachedList = resolve
    })
    const slowFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      if (body?.method === "tools/list") {
        reachedList()
        await gate
      }
      return server.fetch(input, init)
    }) as typeof fetch
    const slow = createConnectorService({
      clients: new ConnectorClientPool(slowFetch)
    })

    const refreshing = slow.refresh(connector.id)
    /** Discovery has captured the original endpoint and is mid-listing. */
    await listing
    await service.save(
      draft({
        id: connector.id,
        url: "http://127.0.0.1:8086/mcp/other",
        secret: { state: "unchanged" }
      })
    )
    release()
    const result = await refreshing

    expect(result.connector.url).toBe("http://127.0.0.1:8086/mcp/other")
    expect(result.connector.tools).toHaveLength(0)
    expect(result.connector.status).toBe("unknown")
    const [stored] = await readConnectors()
    expect(stored.tools).toHaveLength(0)
    expect(stored.discoveredAt).toBeUndefined()
  })

  it("records a refused token as the status and keeps earlier tools", async () => {
    const { connector } = await service.save(draft())
    await service.refresh(connector.id)
    await service.save(
      draft({
        id: connector.id,
        secret: { state: "replaced", value: "wrong" }
      })
    )
    await expect(service.refresh(connector.id)).rejects.toMatchObject({
      messageKey: "settings.connectors.status.unauthorized"
    })
    const [after] = (await service.list()).connectors
    expect(after.status).toBe("unauthorized")
  })

  it("rejects an auth kind the type does not offer", async () => {
    await expect(
      service.save(
        draft({ auth: { kind: "none" }, secret: { state: "unchanged" } })
      )
    ).rejects.toMatchObject({
      messageKey: "settings.connectors.errors.auth_kind"
    })
  })

  it("removes a connector and its stored credential", async () => {
    const { connector } = await service.save(draft())
    expect(await service.remove(connector.id)).toEqual({ removed: true })
    expect(await readConnectors()).toEqual([])
  })

  describe("syncBridge", () => {
    const BASE = "http://127.0.0.1:8086"
    const bridge = (token: string, names: string[]) => {
      const calls: Array<{ url: string; auth: string | null }> = []
      const fetchImpl = (async (
        input: RequestInfo | URL,
        init?: RequestInit
      ) => {
        const auth = new Headers(init?.headers).get("authorization")
        calls.push({ url: String(input), auth })
        if (auth !== `Bearer ${token}`)
          return new Response(null, { status: 401 })
        return Response.json({
          bridge: "olc-mcp",
          version: "0.16.0",
          servers: names.map((name) => ({ name, path: `/mcp/${name}` }))
        })
      }) as typeof fetch
      return { calls, fetchImpl }
    }

    it("adds one connector per bridge server and reuses the stored token on re-sync", async () => {
      const fake = bridge("tok", ["filesystem", "memory"])
      const bridged = createConnectorService({
        clients: new ConnectorClientPool(server.fetch),
        fetch: fake.fetchImpl
      })
      const first = await bridged.syncBridge({
        baseUrl: `${BASE}/`,
        token: "tok"
      })
      expect(first.added).toBe(2)
      expect(
        first.connectors.map((item) => [item.name, item.url, item.hasSecret])
      ).toEqual([
        ["filesystem", `${BASE}/mcp/filesystem`, true],
        ["memory", `${BASE}/mcp/memory`, true]
      ])
      expect(fake.calls[0].url).toBe(`${BASE}/servers`)

      const again = await bridged.syncBridge({ baseUrl: BASE })
      expect(again.added).toBe(0)
      expect(fake.calls.at(-1)?.auth).toBe("Bearer tok")
      expect((await readConnectors()).map((item) => item.auth.secret)).toEqual([
        "tok",
        "tok"
      ])
    })

    it("turns a hand-added HTTP connector at a bridge URL into a bridge connector", async () => {
      const fake = bridge("tok", ["memory"])
      const bridged = createConnectorService({
        clients: new ConnectorClientPool(server.fetch),
        fetch: fake.fetchImpl
      })
      await bridged.save(
        draft({
          type: "mcp-http",
          url: `${BASE}/mcp/memory`,
          auth: { kind: "bearer" },
          secret: { state: "replaced", value: "tok" }
        })
      )
      const result = await bridged.syncBridge({ baseUrl: BASE, token: "tok" })
      expect(result).toMatchObject({ added: 0, skipped: 0 })
      expect(result.connectors[0].type).toBe("mcp-local")
      /** A later sync without a token finds it and reuses the token. */
      await expect(
        bridged.syncBridge({ baseUrl: BASE })
      ).resolves.toMatchObject({ added: 0 })
    })

    it("accepts a bridge listing more servers than fit and reports the overflow", async () => {
      const names = Array.from({ length: 25 }, (_, index) => `s${index}`)
      const bridged = createConnectorService({
        clients: new ConnectorClientPool(server.fetch),
        fetch: bridge("tok", names).fetchImpl
      })
      const result = await bridged.syncBridge({ baseUrl: BASE, token: "tok" })
      expect(result).toMatchObject({ added: 20, skipped: 5 })
    })

    it("re-syncs with the token the last successful sync stored", async () => {
      const first = createConnectorService({
        clients: new ConnectorClientPool(server.fetch),
        fetch: bridge("old", ["a", "b"]).fetchImpl
      })
      await first.syncBridge({ baseUrl: BASE, token: "old" })
      /** The bridge drops `a` and rotates its token. */
      const rotated = bridge("new", ["b"])
      const second = createConnectorService({
        clients: new ConnectorClientPool(server.fetch),
        fetch: rotated.fetchImpl
      })
      await second.syncBridge({ baseUrl: BASE, token: "new" })
      await expect(second.syncBridge({ baseUrl: BASE })).resolves.toMatchObject(
        { added: 0 }
      )
      expect(rotated.calls.at(-1)?.auth).toBe("Bearer new")
    })

    it("does not let an older listing write its token over a newer sync's", async () => {
      let release: () => void = () => undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const slowOld = (async () => {
        await gate
        return Response.json({
          bridge: "olc-mcp",
          servers: [{ name: "memory", path: "/mcp/memory" }]
        })
      }) as typeof fetch
      const older = createConnectorService({
        clients: new ConnectorClientPool(server.fetch),
        fetch: slowOld
      })
      const newer = createConnectorService({
        clients: new ConnectorClientPool(server.fetch),
        fetch: bridge("new", ["memory"]).fetchImpl
      })
      const pending = older.syncBridge({ baseUrl: BASE, token: "old" })
      await new Promise((resolve) => setTimeout(resolve, 0))
      await newer.syncBridge({ baseUrl: BASE, token: "new" })
      release()
      await pending
      expect((await readConnectors())[0].auth.secret).toBe("new")
    })

    it("does not contact the bridge once the caller has cancelled", async () => {
      const fake = bridge("tok", ["memory"])
      const bridged = createConnectorService({
        clients: new ConnectorClientPool(server.fetch),
        fetch: fake.fetchImpl
      })
      const controller = new AbortController()
      controller.abort()
      await expect(
        bridged.syncBridge({ baseUrl: BASE, token: "tok" }, controller.signal)
      ).rejects.toThrow()
      expect(fake.calls).toHaveLength(0)
    })

    it("reports a wrong token without touching stored connectors", async () => {
      const fake = bridge("right", ["memory"])
      const bridged = createConnectorService({
        clients: new ConnectorClientPool(server.fetch),
        fetch: fake.fetchImpl
      })
      await expect(
        bridged.syncBridge({ baseUrl: BASE, token: "wrong" })
      ).rejects.toMatchObject({
        messageKey: "settings.connectors.status.unauthorized"
      })
      expect(await readConnectors()).toEqual([])
    })

    it("refuses a reply that is not an olc bridge listing", async () => {
      const bridged = createConnectorService({
        clients: new ConnectorClientPool(server.fetch),
        fetch: (async () => Response.json({ servers: [] })) as typeof fetch
      })
      await expect(
        bridged.syncBridge({ baseUrl: BASE, token: "t" })
      ).rejects.toMatchObject({
        messageKey: "settings.connectors.status.not_mcp"
      })
    })
  })
})
