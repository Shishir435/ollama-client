import type {
  ConnectorDraft,
  ConnectorsSyncBridgeResult,
  ConnectorToolRisk,
  PublicConnector
} from "@ollama-client/contracts/connector-rpc"
import { RpcMethod } from "@ollama-client/contracts/rpc"
import { extensionRpcClient } from "@/protocol/extension-client"

/** Page-side intents; the background owns storage, credentials and discovery. */
export const loadConnectors = async (): Promise<PublicConnector[]> =>
  (await extensionRpcClient.call(RpcMethod.ConnectorsList, {})).connectors

export const saveConnector = async (
  connector: ConnectorDraft
): Promise<PublicConnector> =>
  (await extensionRpcClient.call(RpcMethod.ConnectorsSave, { connector }))
    .connector

export const removeConnector = async (id: string): Promise<void> => {
  await extensionRpcClient.call(RpcMethod.ConnectorsRemove, { id })
}

export const refreshConnector = async (id: string): Promise<PublicConnector> =>
  (await extensionRpcClient.call(RpcMethod.ConnectorsRefresh, { id })).connector

export const setConnectorTool = async (
  id: string,
  toolName: string,
  change: { enabled?: boolean; riskOverride?: ConnectorToolRisk | null }
): Promise<PublicConnector> =>
  (
    await extensionRpcClient.call(RpcMethod.ConnectorsSetTool, {
      id,
      toolName,
      ...change
    })
  ).connector

export const syncBridge = async (
  baseUrl: string,
  token?: string
): Promise<ConnectorsSyncBridgeResult> =>
  extensionRpcClient.call(RpcMethod.ConnectorsSyncBridge, {
    baseUrl,
    ...(token ? { token } : {})
  })
