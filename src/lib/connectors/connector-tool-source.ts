import type { ToolResult, ToolSource } from "@/lib/tools/types"
import type { ConnectorClientPool } from "./connector-clients"
import { readConnectors } from "./connector-store"
import { buildConnectorToolIndex } from "./connector-tool-index"
import type { StoredConnector } from "./types"

export const CONNECTOR_TOOL_SOURCE_ID = "connectors"

interface ConnectorToolSourceDeps {
  read: () => Promise<StoredConnector[]>
  clients: () => Promise<ConnectorClientPool>
}

const defaultClients = async () =>
  (await import("./connector-clients")).connectorClients

/**
 * Connector tools as one registry source.
 *
 * The list comes from storage, not the network: discovery runs when the user
 * saves or refreshes a connector, so a dead server never slows a chat turn and
 * a slow one never hides another's tools. The registry caches the list until
 * the connector key changes (see `startup.ts`). The MCP client itself loads on
 * the first call.
 */
export const createConnectorToolSource = (
  deps: ConnectorToolSourceDeps = {
    read: readConnectors,
    clients: defaultClients
  }
): ToolSource => ({
  id: CONNECTOR_TOOL_SOURCE_ID,
  listTools: async () =>
    buildConnectorToolIndex(await deps.read()).map((entry) => entry.definition),
  callTool: async (name, args, ctx): Promise<ToolResult> => {
    const entry = buildConnectorToolIndex(await deps.read()).find(
      (candidate) => candidate.definition.name === name
    )
    if (!entry) {
      return {
        content: `The tool "${name}" is no longer offered by any connector. It did not run.`,
        isError: true,
        provenance: "web-untrusted"
      }
    }
    const [{ callConnectorTool }, clients] = await Promise.all([
      import("./connector-call"),
      deps.clients()
    ])
    return callConnectorTool(entry, args, ctx, clients)
  }
})
