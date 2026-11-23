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
  service = createConnectorService(new ConnectorClientPool(server.fetch))
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
})
