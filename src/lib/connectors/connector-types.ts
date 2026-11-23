import type {
  ConnectorAuthKind,
  ConnectorType
} from "@ollama-client/contracts/connector-rpc"

/**
 * What a connector type contributes: how the settings page presents it and
 * which credentials it accepts. Both current types speak MCP over Streamable
 * HTTP; a new transport is one more entry here plus its client, never a change
 * to the tool source or the chat path.
 */
export interface ConnectorTypeDefinition {
  id: ConnectorType
  labelKey: string
  descriptionKey: string
  /** Prefilled when the user picks this type for a new connector. */
  defaultUrl: string
  defaultAuth: ConnectorAuthKind
  authKinds: readonly ConnectorAuthKind[]
}

/** Port `olc mcp` listens on unless its config says otherwise. */
export const OLC_MCP_DEFAULT_PORT = 8086

const DEFINITIONS: Record<ConnectorType, ConnectorTypeDefinition> = {
  "mcp-local": {
    id: "mcp-local",
    labelKey: "settings.connectors.types.mcp_local.label",
    descriptionKey: "settings.connectors.types.mcp_local.description",
    defaultUrl: `http://127.0.0.1:${OLC_MCP_DEFAULT_PORT}/mcp/`,
    defaultAuth: "bearer",
    authKinds: ["bearer"]
  },
  "mcp-http": {
    id: "mcp-http",
    labelKey: "settings.connectors.types.mcp_http.label",
    descriptionKey: "settings.connectors.types.mcp_http.description",
    defaultUrl: "http://127.0.0.1:8000/mcp",
    defaultAuth: "none",
    authKinds: ["none", "bearer", "header"]
  }
}

export const CONNECTOR_TYPES: readonly ConnectorTypeDefinition[] = [
  DEFINITIONS["mcp-local"],
  DEFINITIONS["mcp-http"]
]

export const getConnectorType = (id: ConnectorType): ConnectorTypeDefinition =>
  DEFINITIONS[id]
