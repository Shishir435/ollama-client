import { browser } from "@/lib/browser-api"
import { McpClient } from "./mcp/mcp-client"
import type { StoredConnector } from "./types"

/** Request timeout for a tool call or list; a slow tool is still a tool. */
const CALL_TIMEOUT_MS = 120_000

const clientVersion = (): string => {
  try {
    return browser.runtime.getManifest().version
  } catch {
    return "0.0.0"
  }
}

/** The headers a connector's credential becomes. Never logged or returned. */
export const connectorAuthHeaders = (
  connector: Pick<StoredConnector, "auth">
): Record<string, string> => {
  const { kind, headerName, secret } = connector.auth
  if (!secret) return {}
  if (kind === "bearer") return { Authorization: `Bearer ${secret}` }
  if (kind === "header" && headerName) return { [headerName]: secret }
  return {}
}

/**
 * Everything that makes a session belong to one configuration. A changed URL
 * or credential must not reuse a session the server opened for the old one.
 */
const fingerprint = (connector: StoredConnector): string =>
  JSON.stringify([
    connector.url,
    connector.auth.kind,
    connector.auth.headerName ?? "",
    connector.auth.secret ?? ""
  ])

/**
 * One live MCP session per connector, kept for the worker's lifetime so tool
 * calls don't each pay a handshake. Held in memory only.
 */
export class ConnectorClientPool {
  private readonly clients = new Map<
    string,
    { fingerprint: string; client: McpClient }
  >()

  constructor(private readonly fetchImpl?: typeof fetch) {}

  get(connector: StoredConnector): McpClient {
    const print = fingerprint(connector)
    const existing = this.clients.get(connector.id)
    if (existing?.fingerprint === print) return existing.client
    if (existing) void existing.client.close()
    const client = this.create(connector)
    this.clients.set(connector.id, { fingerprint: print, client })
    return client
  }

  /** A fresh client that is not pooled, for discovery from settings. */
  create(connector: StoredConnector): McpClient {
    return new McpClient({
      url: connector.url,
      authHeaders: () => connectorAuthHeaders(connector),
      fetch: this.fetchImpl,
      timeoutMs: CALL_TIMEOUT_MS,
      clientVersion: clientVersion()
    })
  }

  drop(connectorId: string): void {
    const existing = this.clients.get(connectorId)
    if (!existing) return
    this.clients.delete(connectorId)
    void existing.client.close()
  }
}

export const connectorClients = new ConnectorClientPool()
