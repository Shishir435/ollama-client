import { z } from "zod"

/**
 * Connector RPC contracts.
 *
 * A connector is one configured instance of a connector type (an MCP server
 * reached over Streamable HTTP, or a stdio MCP server behind the local `olc
 * mcp` bridge). Its credential never crosses this boundary: pages see only
 * `hasSecret` and send an explicit mutation intent when they change it.
 */

export const ConnectorTypeSchema = z.enum(["mcp-http", "mcp-local"])

/** @see ConnectorTypeSchema */
export type ConnectorType = z.infer<typeof ConnectorTypeSchema>

export const ConnectorAuthKindSchema = z.enum(["none", "bearer", "header"])

/** @see ConnectorAuthKindSchema */
export type ConnectorAuthKind = z.infer<typeof ConnectorAuthKindSchema>

export const ConnectorToolRiskSchema = z.enum([
  "low",
  "medium",
  "high",
  "critical"
])

/** @see ConnectorToolRiskSchema */
export type ConnectorToolRisk = z.infer<typeof ConnectorToolRiskSchema>

/**
 * HTTP header names a connector may carry its credential in. The pattern is
 * the RFC 9110 token; headers the transport owns are rejected so a connector
 * cannot overwrite the session or protocol negotiation.
 */
const RESERVED_HEADER_NAMES = new Set([
  "accept",
  "content-type",
  "content-length",
  "host",
  "origin",
  "mcp-session-id",
  "mcp-protocol-version",
  "last-event-id"
])

export const ConnectorHeaderNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/)
  .refine((name) => !RESERVED_HEADER_NAMES.has(name.toLowerCase()))

/**
 * An http(s) endpoint with no credentials in the authority: a token belongs in
 * the connector's secret, where it is never displayed or logged.
 */
export const ConnectorUrlSchema = z
  .url({ protocol: /^https?$/ })
  .max(2048)
  .regex(/^https?:\/\/[^/?#@]+(?:[/?#]|$)/i)

export const ConnectorAuthSchema = z
  .object({
    kind: ConnectorAuthKindSchema,
    headerName: ConnectorHeaderNameSchema.optional()
  })
  .strict()
  .refine((auth) => auth.kind !== "header" || Boolean(auth.headerName))

const ConnectorSecretDraftSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("unchanged") }).strict(),
  z
    .object({
      state: z.literal("replaced"),
      value: z.string().min(1).max(8192)
    })
    .strict(),
  z.object({ state: z.literal("cleared") }).strict()
])

/** @see ConnectorSecretDraftSchema */
export type ConnectorSecretDraft = z.infer<typeof ConnectorSecretDraftSchema>

export const ConnectorIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/)

/** Editable connector shape sent by extension pages. `id` absent = new. */
export const ConnectorDraftSchema = z
  .object({
    id: ConnectorIdSchema.optional(),
    type: ConnectorTypeSchema,
    name: z.string().trim().min(1).max(60),
    url: ConnectorUrlSchema,
    enabled: z.boolean(),
    auth: ConnectorAuthSchema,
    secret: ConnectorSecretDraftSchema
  })
  .strict()

/** @see ConnectorDraftSchema */
export type ConnectorDraft = z.infer<typeof ConnectorDraftSchema>

export const ConnectorStatusSchema = z.enum([
  "unknown",
  "ok",
  "unreachable",
  "unauthorized",
  "not_mcp",
  "unsupported_version",
  "timeout",
  "server_error"
])

/** @see ConnectorStatusSchema */
export type ConnectorStatus = z.infer<typeof ConnectorStatusSchema>

/** A discovered tool as pages see it: no schema, just what gates and labels it. */
export const PublicConnectorToolSchema = z
  .object({
    name: z.string().min(1).max(128),
    title: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
    enabled: z.boolean(),
    /** Risk the annotations suggest; what applies when there is no override. */
    suggestedRisk: ConnectorToolRiskSchema,
    riskOverride: ConnectorToolRiskSchema.optional(),
    readOnly: z.boolean(),
    destructive: z.boolean(),
    /** The name the model sees, once the tool is enabled and offered. */
    modelName: z.string().max(64).optional()
  })
  .strict()

/** @see PublicConnectorToolSchema */
export type PublicConnectorTool = z.infer<typeof PublicConnectorToolSchema>

/** Credential-free connector safe to return to extension pages. */
export const PublicConnectorSchema = z
  .object({
    id: ConnectorIdSchema,
    type: ConnectorTypeSchema,
    name: z.string().min(1).max(60),
    url: z.string().max(2048),
    enabled: z.boolean(),
    auth: ConnectorAuthSchema,
    hasSecret: z.boolean(),
    status: ConnectorStatusSchema,
    serverName: z.string().max(200).optional(),
    discoveredAt: z.number().int().nonnegative().optional(),
    tools: z.array(PublicConnectorToolSchema).max(500)
  })
  .strict()

/** @see PublicConnectorSchema */
export type PublicConnector = z.infer<typeof PublicConnectorSchema>

export const ConnectorsListRequestSchema = z.object({}).strict()
export const ConnectorsListResultSchema = z
  .object({ connectors: z.array(PublicConnectorSchema).max(50) })
  .strict()

export const ConnectorsSaveRequestSchema = z
  .object({ connector: ConnectorDraftSchema })
  .strict()
export const ConnectorResultSchema = z
  .object({ connector: PublicConnectorSchema })
  .strict()

export const ConnectorsRemoveRequestSchema = z
  .object({ id: ConnectorIdSchema })
  .strict()
export const ConnectorsRemoveResultSchema = z
  .object({ removed: z.boolean() })
  .strict()

/** Re-handshake and re-list the connector's tools, keeping the user's choices. */
export const ConnectorsRefreshRequestSchema = z
  .object({ id: ConnectorIdSchema })
  .strict()

export const ConnectorsSetToolRequestSchema = z
  .object({
    id: ConnectorIdSchema,
    toolName: z.string().min(1).max(128),
    enabled: z.boolean().optional(),
    /** `null` clears the override and returns to the suggested risk. */
    riskOverride: ConnectorToolRiskSchema.nullable().optional()
  })
  .strict()

/**
 * Connect a local bridge once and add every server it runs. `token` is
 * optional on a re-sync: the background reuses the one already stored for a
 * connector on that bridge.
 */
export const ConnectorsSyncBridgeRequestSchema = z
  .object({
    baseUrl: ConnectorUrlSchema,
    token: z.string().min(1).max(8192).optional()
  })
  .strict()
export const ConnectorsSyncBridgeResultSchema = z
  .object({
    connectors: z.array(PublicConnectorSchema).max(50),
    added: z.number().int().nonnegative(),
    /** Servers the bridge lists that did not fit under the connector limit. */
    skipped: z.number().int().nonnegative()
  })
  .strict()

export type ConnectorsSyncBridgeRequest = z.infer<
  typeof ConnectorsSyncBridgeRequestSchema
>
export type ConnectorsSyncBridgeResult = z.infer<
  typeof ConnectorsSyncBridgeResultSchema
>
export type ConnectorsListRequest = z.infer<typeof ConnectorsListRequestSchema>
export type ConnectorsListResult = z.infer<typeof ConnectorsListResultSchema>
export type ConnectorsSaveRequest = z.infer<typeof ConnectorsSaveRequestSchema>
export type ConnectorResult = z.infer<typeof ConnectorResultSchema>
export type ConnectorsRemoveRequest = z.infer<
  typeof ConnectorsRemoveRequestSchema
>
export type ConnectorsRemoveResult = z.infer<
  typeof ConnectorsRemoveResultSchema
>
export type ConnectorsRefreshRequest = z.infer<
  typeof ConnectorsRefreshRequestSchema
>
export type ConnectorsSetToolRequest = z.infer<
  typeof ConnectorsSetToolRequestSchema
>
