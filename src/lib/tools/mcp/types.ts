/**
 * MCP server configuration, as stored in `STORAGE_KEYS.MCP.SERVERS`.
 *
 * The extension speaks the streamable-HTTP transport (single endpoint, POST
 * JSON-RPC requests, SSE or chunked-JSON responses). Servers that only expose
 * stdio are bridged to HTTP by the companion script in `tools/mcp-bridge/` —
 * a Chrome extension cannot spawn processes.
 */

import { z } from "zod"

export const McpServerSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  url: z.string().url(),
  enabled: z.boolean().default(true)
})

export type McpServer = z.infer<typeof McpServerSchema>

/** Stored list of user-configured servers. Capped so a bad paste can't bloat storage. */
export const McpServersSchema = z.array(McpServerSchema).max(20)

export type McpServersConfig = z.infer<typeof McpServersSchema>

/** A single tool as reported by an MCP server's tools/list. */
export interface McpTool {
  name: string
  description?: string
  inputSchema?: {
    type?: string
    properties?: Record<string, unknown>
    required?: string[]
  }
}

/**
 * Slug used to prefix tool names so two servers can never collide and no MCP
 * name can shadow a built-in. `wordcraft` -> `wordcraft_open_document`.
 */
export const mcpSlug = (name: string): string => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
  return slug || "mcp"
}

/** Prefix an MCP tool name with its server slug; keeps the result under 64 chars. */
export const mcpToolName = (slug: string, rawName: string): string => {
  const sanitized = rawName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 52)
  return `${slug}_${sanitized}`
}
