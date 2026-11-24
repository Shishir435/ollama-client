import type { ToolResult, ToolSource } from "@/lib/tools/types"
import type { ConnectorClientPool } from "./connector-clients"
import { readConnectors } from "./connector-store"
import {
  buildConnectorToolIndex,
  connectorGrantScope
} from "./connector-tool-index"
import type { StoredConnector } from "./types"

export const CONNECTOR_TOOL_SOURCE_ID = "connectors"

interface ConnectorToolSourceDeps {
  read: () => Promise<StoredConnector[]>
  clients: () => Promise<ConnectorClientPool>
  /** Built-in tool names a connector tool must never take. */
  reserved?: ReadonlySet<string>
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
  overrides: Partial<ConnectorToolSourceDeps> = {}
): ToolSource => {
  const deps: ConnectorToolSourceDeps = {
    read: readConnectors,
    clients: defaultClients,
    ...overrides
  }
  return {
    id: CONNECTOR_TOOL_SOURCE_ID,
    listTools: async () =>
      buildConnectorToolIndex(await deps.read(), deps.reserved).map(
        (entry) => entry.definition
      ),
    callTool: async (name, args, ctx): Promise<ToolResult> => {
      const entry = buildConnectorToolIndex(
        await deps.read(),
        deps.reserved
      ).find((candidate) => candidate.definition.name === name)
      if (!entry) {
        return {
          content: `The tool "${name}" is no longer offered by any connector. It did not run.`,
          isError: true,
          provenance: "web-untrusted"
        }
      }
      /** Switched off for this chat: never run, whatever the model calls. */
      if (ctx.disabledConnectorIds?.includes(entry.connector.id)) {
        return {
          content: `The tool "${name}" is turned off for this chat. It did not run.`,
          isError: true,
          provenance: "web-untrusted"
        }
      }
      /**
       * The approval named one connector; if the name now resolves to another
       * (removed and re-added, moved to a new endpoint), the call is refused.
       */
      if (
        ctx.approvedOrigin !== undefined &&
        ctx.approvedOrigin !==
          connectorGrantScope(entry.connector, entry.tool.name)
      ) {
        return {
          content: `The connector behind "${name}" changed after it was approved, so it did not run.`,
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
  }
}
