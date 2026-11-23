import {
  ConnectorAuthKindSchema,
  ConnectorHeaderNameSchema,
  ConnectorIdSchema,
  ConnectorStatusSchema,
  ConnectorToolRiskSchema,
  ConnectorTypeSchema
} from "@ollama-client/contracts/connector-rpc"
import { z } from "zod"

/**
 * Persisted connector state under `STORAGE_KEYS.CONNECTORS.LIST`.
 *
 * Discovered tools are stored with their input schemas so a chat turn offers
 * them without touching the network; only a refresh, or a call, talks to the
 * server. The credential lives here too (device-local, like web-search keys)
 * and leaves this module only as an HTTP header.
 */

export const MAX_CONNECTORS = 20
export const MAX_TOOLS_PER_CONNECTOR = 200
/** A larger schema is not offered: it would crowd a local model's context. */
export const MAX_TOOL_SCHEMA_CHARS = 32_000

export const McpToolAnnotationsSchema = z
  .object({
    title: z.string().max(200).optional().catch(undefined),
    readOnlyHint: z.boolean().optional().catch(undefined),
    destructiveHint: z.boolean().optional().catch(undefined),
    idempotentHint: z.boolean().optional().catch(undefined),
    openWorldHint: z.boolean().optional().catch(undefined)
  })
  .catch({})

/** @see McpToolAnnotationsSchema */
export type McpToolAnnotations = z.infer<typeof McpToolAnnotationsSchema>

export const StoredConnectorToolSchema = z.object({
  name: z.string().min(1).max(128),
  title: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  inputSchema: z.record(z.string(), z.unknown()),
  annotations: McpToolAnnotationsSchema.optional(),
  enabled: z.boolean(),
  riskOverride: ConnectorToolRiskSchema.optional()
})

/** @see StoredConnectorToolSchema */
export type StoredConnectorTool = z.infer<typeof StoredConnectorToolSchema>

export const StoredConnectorSchema = z.object({
  id: ConnectorIdSchema,
  type: ConnectorTypeSchema,
  name: z.string().min(1).max(60),
  url: z.string().max(2048),
  enabled: z.boolean(),
  auth: z.object({
    kind: ConnectorAuthKindSchema,
    headerName: ConnectorHeaderNameSchema.optional(),
    secret: z.string().max(8192).optional()
  }),
  status: ConnectorStatusSchema.catch("unknown"),
  serverName: z.string().max(200).optional().catch(undefined),
  discoveredAt: z.number().int().nonnegative().optional().catch(undefined),
  tools: z.array(StoredConnectorToolSchema).max(MAX_TOOLS_PER_CONNECTOR)
})

/** @see StoredConnectorSchema */
export type StoredConnector = z.infer<typeof StoredConnectorSchema>

/**
 * One malformed entry drops only itself, so a bad write to one connector can't
 * take every other connector's tools away.
 */
export const parseStoredConnectors = (value: unknown): StoredConnector[] => {
  if (!Array.isArray(value)) return []
  const connectors: StoredConnector[] = []
  for (const entry of value.slice(0, MAX_CONNECTORS)) {
    const parsed = StoredConnectorSchema.safeParse(entry)
    if (parsed.success) connectors.push(parsed.data)
  }
  return connectors
}
