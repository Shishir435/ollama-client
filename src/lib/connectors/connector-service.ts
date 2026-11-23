import type {
  ConnectorDraft,
  ConnectorStatus,
  ConnectorsSetToolRequest,
  ConnectorsSyncBridgeRequest,
  ConnectorsSyncBridgeResult,
  PublicConnector
} from "@ollama-client/contracts/connector-rpc"
import { z } from "zod"
import { createAppError } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import { type ConnectorClientPool, connectorClients } from "./connector-clients"
import {
  isDestructiveConnectorTool,
  suggestedConnectorRisk
} from "./connector-risk"
import { mutateConnectors, readConnectors } from "./connector-store"
import { buildConnectorToolIndex } from "./connector-tool-index"
import { getConnectorType } from "./connector-types"
import { McpError, type McpListedTool } from "./mcp/mcp-client"
import {
  MAX_CONNECTORS,
  MAX_TOOLS_PER_CONNECTOR,
  McpToolAnnotationsSchema,
  type StoredConnector,
  type StoredConnectorTool
} from "./types"

/** Bounded so a hung server can't hold the settings page. */
const DISCOVERY_TIMEOUT_MS = 30_000

const notFound = () =>
  createAppError("Connector not found", {
    kind: "storage",
    messageKey: "settings.connectors.errors.not_found",
    status: 404
  })

const invalid = (messageKey: string) =>
  createAppError("Invalid connector", {
    kind: "validation",
    messageKey,
    status: 400
  })

export const toPublicConnector = (
  connector: StoredConnector
): PublicConnector => {
  const offered = new Map(
    buildConnectorToolIndex([connector]).map((entry) => [
      entry.tool.name,
      entry.definition.name
    ])
  )
  return {
    id: connector.id,
    type: connector.type,
    name: connector.name,
    url: connector.url,
    enabled: connector.enabled,
    auth: {
      kind: connector.auth.kind,
      ...(connector.auth.headerName
        ? { headerName: connector.auth.headerName }
        : {})
    },
    hasSecret: Boolean(connector.auth.secret),
    status: connector.status,
    ...(connector.serverName ? { serverName: connector.serverName } : {}),
    ...(connector.discoveredAt !== undefined
      ? { discoveredAt: connector.discoveredAt }
      : {}),
    tools: connector.tools.map((tool) => ({
      name: tool.name,
      ...(tool.title ? { title: tool.title } : {}),
      ...(tool.description ? { description: tool.description } : {}),
      enabled: tool.enabled,
      suggestedRisk: suggestedConnectorRisk(tool.annotations),
      ...(tool.riskOverride ? { riskOverride: tool.riskOverride } : {}),
      readOnly: tool.annotations?.readOnlyHint === true,
      destructive: isDestructiveConnectorTool(tool.annotations),
      ...(offered.has(tool.name) ? { modelName: offered.get(tool.name) } : {})
    }))
  }
}

const statusFor = (error: unknown): ConnectorStatus => {
  if (!(error instanceof McpError)) return "server_error"
  switch (error.kind) {
    case "unreachable":
    case "aborted":
      return "unreachable"
    case "unauthorized":
      return "unauthorized"
    case "unsupported_version":
      return "unsupported_version"
    case "timeout":
      return "timeout"
    case "not_mcp":
    case "session_expired":
      return "not_mcp"
    default:
      return "server_error"
  }
}

/**
 * Merge a fresh tool list into the stored one. The user's toggle and risk
 * choices survive by tool name; a new tool arrives enabled at its suggested
 * risk, and a tool the server no longer lists is dropped.
 */
export const mergeDiscoveredTools = (
  previous: readonly StoredConnectorTool[],
  listed: readonly McpListedTool[]
): StoredConnectorTool[] => {
  const byName = new Map(previous.map((tool) => [tool.name, tool]))
  const seen = new Set<string>()
  const merged: StoredConnectorTool[] = []
  for (const tool of listed) {
    if (seen.has(tool.name) || tool.name.length > 128) continue
    seen.add(tool.name)
    const prior = byName.get(tool.name)
    const annotations = McpToolAnnotationsSchema.parse(tool.annotations ?? {})
    merged.push({
      name: tool.name,
      ...(tool.title || annotations.title
        ? { title: (tool.title ?? annotations.title)?.slice(0, 200) }
        : {}),
      ...(tool.description
        ? { description: tool.description.slice(0, 2000) }
        : {}),
      inputSchema: tool.inputSchema,
      annotations,
      enabled: prior?.enabled ?? true,
      ...(prior?.riskOverride ? { riskOverride: prior.riskOverride } : {})
    })
    if (merged.length >= MAX_TOOLS_PER_CONNECTOR) break
  }
  return merged
}

const sameEndpoint = (a: StoredConnector, b: StoredConnector): boolean =>
  a.url === b.url &&
  a.auth.kind === b.auth.kind &&
  a.auth.headerName === b.auth.headerName &&
  a.auth.secret === b.auth.secret

const newConnectorId = (): string =>
  `c_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`

/** Normalized bridge base: origin plus path, no trailing slash. */
const bridgeBase = (baseUrl: string): string => {
  const url = new URL(baseUrl)
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`
}

const BridgeServersSchema = z.object({
  bridge: z.literal("olc-mcp"),
  servers: z
    .array(
      z.object({
        name: z.string().min(1).max(64),
        path: z.string().regex(/^\/mcp\/[^/?#]+$/)
      })
    )
    .max(MAX_CONNECTORS)
})

const BRIDGE_TIMEOUT_MS = 10_000

const bridgeFailure = (status: ConnectorStatus) =>
  createAppError("Bridge sync failed", {
    kind: "provider",
    messageKey: `settings.connectors.status.${status}`,
    retryable: status !== "unauthorized"
  })

export const createConnectorService = (
  clients: ConnectorClientPool = connectorClients,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init)
) => ({
  async list(): Promise<{ connectors: PublicConnector[] }> {
    return { connectors: (await readConnectors()).map(toPublicConnector) }
  },

  async save(draft: ConnectorDraft): Promise<{ connector: PublicConnector }> {
    const type = getConnectorType(draft.type)
    if (!type.authKinds.includes(draft.auth.kind)) {
      throw invalid("settings.connectors.errors.auth_kind")
    }
    const saved = await mutateConnectors((current) => {
      const existing = draft.id
        ? current.find((connector) => connector.id === draft.id)
        : undefined
      if (draft.id && !existing) throw notFound()
      if (!existing && current.length >= MAX_CONNECTORS) {
        throw invalid("settings.connectors.errors.too_many")
      }
      const secret =
        draft.secret.state === "replaced"
          ? draft.secret.value
          : draft.secret.state === "cleared"
            ? undefined
            : existing?.auth.secret
      const next: StoredConnector = {
        id: existing?.id ?? newConnectorId(),
        type: draft.type,
        name: draft.name,
        url: draft.url,
        enabled: draft.enabled,
        auth: {
          kind: draft.auth.kind,
          ...(draft.auth.kind === "header" && draft.auth.headerName
            ? { headerName: draft.auth.headerName }
            : {}),
          ...(draft.auth.kind !== "none" && secret ? { secret } : {})
        },
        status: "unknown",
        tools: []
      }
      /**
       * Tools discovered from a different endpoint or credential describe a
       * server this connector no longer names, so they are not carried over.
       */
      if (existing && sameEndpoint(existing, next)) {
        next.status = existing.status
        next.serverName = existing.serverName
        next.discoveredAt = existing.discoveredAt
        next.tools = existing.tools
      }
      const list = existing
        ? current.map((connector) =>
            connector.id === existing.id ? next : connector
          )
        : [...current, next]
      return { next: list, result: next }
    })
    if (draft.id) clients.drop(saved.id)
    return { connector: toPublicConnector(saved) }
  },

  async remove(id: string): Promise<{ removed: boolean }> {
    const removed = await mutateConnectors((current) => {
      const next = current.filter((connector) => connector.id !== id)
      return { next, result: next.length !== current.length }
    })
    clients.drop(id)
    return { removed }
  },

  /**
   * Handshake and list on a fresh session, then merge. A failure is recorded
   * as the connector's status and rethrown with a key the page can show; the
   * previously discovered tools stay, so a server that is briefly down does
   * not lose the user's choices.
   */
  async refresh(
    id: string,
    signal?: AbortSignal
  ): Promise<{ connector: PublicConnector }> {
    const connector = (await readConnectors()).find((item) => item.id === id)
    if (!connector) throw notFound()
    const client = clients.create(connector)
    /** Not `AbortSignal.any`: Firefox 114, the floor, lacks it. */
    const deadline = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      deadline.abort()
    }, DISCOVERY_TIMEOUT_MS)
    const forward = () => deadline.abort()
    signal?.addEventListener("abort", forward, { once: true })
    const combined = deadline.signal
    let listed: McpListedTool[]
    let serverName: string | undefined
    try {
      await client.ensureInitialized(combined)
      serverName = client.server.name
      listed = await client.listTools(combined)
    } catch (error) {
      /** The page went away: say nothing about the server. */
      if (signal?.aborted && !timedOut) throw error
      const status = timedOut ? "timeout" : statusFor(error)
      logger.warn("Connector discovery failed", "ConnectorService", {
        connectorId: id,
        kind: error instanceof McpError ? error.kind : "unexpected",
        status: error instanceof McpError ? error.status : undefined
      })
      await mutateConnectors((current) => ({
        next: current.map((item) =>
          item.id === id ? { ...item, status } : item
        ),
        result: undefined
      }))
      throw createAppError("Connector discovery failed", {
        kind: "provider",
        messageKey: `settings.connectors.status.${status}`,
        retryable: status !== "unauthorized"
      })
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener("abort", forward)
      void client.close()
    }
    const updated = await mutateConnectors((current) => {
      const target = current.find((item) => item.id === id)
      if (!target) throw notFound()
      const next: StoredConnector = {
        ...target,
        status: "ok",
        ...(serverName ? { serverName } : {}),
        discoveredAt: Date.now(),
        tools: mergeDiscoveredTools(target.tools, listed)
      }
      return {
        next: current.map((item) => (item.id === id ? next : item)),
        result: next
      }
    })
    clients.drop(id)
    return { connector: toPublicConnector(updated) }
  },

  /**
   * Ask a bridge which servers it runs and keep one connector per server.
   * Existing connectors at the same URL keep their tools and choices; only
   * the token is refreshed. Servers the bridge stopped listing are left alone:
   * removing a connector is the user's call.
   */
  async syncBridge(
    request: ConnectorsSyncBridgeRequest,
    signal?: AbortSignal
  ): Promise<ConnectorsSyncBridgeResult> {
    const base = bridgeBase(request.baseUrl)
    const stored = await readConnectors()
    const onBridge = (connector: StoredConnector) =>
      connector.type === "mcp-local" && connector.url.startsWith(`${base}/mcp/`)
    const token =
      request.token ??
      stored.find((connector) => onBridge(connector) && connector.auth.secret)
        ?.auth.secret
    if (!token) throw bridgeFailure("unauthorized")

    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(), BRIDGE_TIMEOUT_MS)
    const forward = () => deadline.abort()
    signal?.addEventListener("abort", forward, { once: true })
    let listed: z.infer<typeof BridgeServersSchema>["servers"]
    try {
      let response: Response
      try {
        response = await fetchImpl(`${base}/servers`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: deadline.signal
        })
      } catch {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
        throw bridgeFailure("unreachable")
      }
      if (response.status === 401 || response.status === 403) {
        throw bridgeFailure("unauthorized")
      }
      if (!response.ok) throw bridgeFailure("not_mcp")
      const parsed = BridgeServersSchema.safeParse(
        await response.json().catch(() => undefined)
      )
      if (!parsed.success) throw bridgeFailure("not_mcp")
      listed = parsed.data.servers
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener("abort", forward)
    }

    const { touched, added } = await mutateConnectors((current) => {
      const next = [...current]
      const touched: StoredConnector[] = []
      let added = 0
      for (const server of listed) {
        const url = `${base}${server.path}`
        const index = next.findIndex((connector) => connector.url === url)
        if (index !== -1) {
          const existing = next[index]
          const updated: StoredConnector =
            existing.auth.secret === token
              ? existing
              : {
                  ...existing,
                  type: "mcp-local",
                  auth: { kind: "bearer", secret: token },
                  status: "unknown"
                }
          next[index] = updated
          touched.push(updated)
          continue
        }
        if (next.length >= MAX_CONNECTORS) break
        const created: StoredConnector = {
          id: newConnectorId(),
          type: "mcp-local",
          name: server.name.slice(0, 60),
          url,
          enabled: true,
          auth: { kind: "bearer", secret: token },
          status: "unknown",
          tools: []
        }
        next.push(created)
        touched.push(created)
        added += 1
      }
      return { next, result: { touched, added } }
    })
    for (const connector of touched) clients.drop(connector.id)
    return { connectors: touched.map(toPublicConnector), added }
  },

  async setTool(
    request: ConnectorsSetToolRequest
  ): Promise<{ connector: PublicConnector }> {
    const updated = await mutateConnectors((current) => {
      const target = current.find((item) => item.id === request.id)
      if (!target) throw notFound()
      if (!target.tools.some((tool) => tool.name === request.toolName)) {
        throw notFound()
      }
      const next: StoredConnector = {
        ...target,
        tools: target.tools.map((tool) => {
          if (tool.name !== request.toolName) return tool
          const changed: StoredConnectorTool = {
            ...tool,
            ...(request.enabled !== undefined
              ? { enabled: request.enabled }
              : {})
          }
          if (request.riskOverride === null) delete changed.riskOverride
          else if (request.riskOverride) {
            changed.riskOverride = request.riskOverride
          }
          return changed
        })
      }
      return {
        next: current.map((item) => (item.id === request.id ? next : item)),
        result: next
      }
    })
    return { connector: toPublicConnector(updated) }
  }
})

export const ConnectorService = createConnectorService()
