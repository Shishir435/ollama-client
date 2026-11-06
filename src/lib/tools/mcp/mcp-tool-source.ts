/**
 * MCP tool source. Registers every enabled user-configured MCP server as a
 * sibling of the internal and web-search sources (see `build-tool-registry.ts`).
 *
 * Tool names are prefixed with the server slug (`wordcraft_open_document`) so
 * two servers can never collide and no MCP name can shadow a built-in. The
 * registry treats this source as non-volatile; the background invalidates it
 * when `STORAGE_KEYS.MCP.SERVERS` changes (see `src/background/startup.ts`).
 */

import { logger } from "@/lib/logger"
import { readSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"
import type {
  ToolContext,
  ToolDefinition,
  ToolResult,
  ToolSource
} from "../types"
import { McpClient, McpConnectionError } from "./mcp-client"
import type { McpServer, McpTool } from "./types"
import { mcpSlug, mcpToolName } from "./types"

const clients = new Map<string, McpClient>()

/** Prefixed name -> owning server and raw tool name. Rebuilt on every list. */
const toolIndex = new Map<string, { server: McpServer; rawName: string }>()

const clientFor = (server: McpServer): McpClient => {
  const key = `${server.id}::${server.url}`
  let client = clients.get(key)
  if (!client) {
    client = new McpClient(server)
    clients.set(key, client)
  }
  return client
}

const toToolDefinition = (
  server: McpServer,
  tool: McpTool
): ToolDefinition => ({
  name: mcpToolName(mcpSlug(server.name), tool.name),
  description: tool.description ?? `MCP tool from ${server.name}.`,
  parameters: {
    type: "object",
    properties: tool.inputSchema?.properties ?? {},
    required: tool.inputSchema?.required
  },
  category: "external",
  risk: "medium",
  resultProvenance: "web-untrusted"
})

const isRetryable = (error: unknown): boolean =>
  error instanceof McpConnectionError && error.retryable

export const createMcpToolSource = (): ToolSource => ({
  id: "mcp",
  volatile: false,
  listTools: async () => {
    const servers = await readSetting(SETTINGS.MCP_SERVERS)
    toolIndex.clear()
    const out: ToolDefinition[] = []
    for (const server of servers) {
      if (!server.enabled) continue
      try {
        const client = clientFor(server)
        await client.ensureInitialized()
        const tools = await client.listTools()
        for (const tool of tools) {
          const definition = toToolDefinition(server, tool)
          toolIndex.set(definition.name, { server, rawName: tool.name })
          out.push(definition)
        }
      } catch (error) {
        logger.warn("MCP server failed to list tools", "McpToolSource", {
          serverId: server.id,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
    return out
  },
  callTool: async (name, args, ctx): Promise<ToolResult> => {
    const entry = toolIndex.get(name)
    if (!entry) {
      // Tool list may be stale after a server config change; re-list once.
      await createMcpToolSource().listTools()
      const retryEntry = toolIndex.get(name)
      if (!retryEntry)
        return { content: `Unknown MCP tool: ${name}`, isError: true }
      return callServerTool(retryEntry, args, ctx)
    }
    return callServerTool(entry, args, ctx)
  }
})

async function callServerTool(
  entry: { server: McpServer; rawName: string },
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const client = clientFor(entry.server)
  try {
    await client.ensureInitialized(ctx.signal)
    const content = await client.callTool(entry.rawName, args, ctx.signal)
    return { content, isError: false, provenance: "web-untrusted" }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (ctx.signal?.aborted) {
      return {
        content: `MCP tool "${entry.rawName}" was aborted before completing.`,
        isError: true,
        provenance: "web-untrusted"
      }
    }
    if (!isRetryable(error)) {
      // Timeout or HTTP error after the request went out: the tool may have
      // already run. Do not replay; tell the model to confirm before retrying.
      return {
        content: `MCP tool "${entry.rawName}" failed (${message}). It may have already executed; do not repeat this call without confirming with the user.`,
        isError: true,
        provenance: "web-untrusted"
      }
    }
    // Pre-send network failure: nothing was sent, so re-initialize and retry once.
    client.reset()
    try {
      await client.ensureInitialized(ctx.signal)
      const content = await client.callTool(entry.rawName, args, ctx.signal)
      return { content, isError: false, provenance: "web-untrusted" }
    } catch (retryError) {
      const retryMessage =
        retryError instanceof Error ? retryError.message : String(retryError)
      logger.error("MCP tool call failed after retry", "McpToolSource", {
        serverId: entry.server.id,
        tool: entry.rawName,
        error: retryMessage
      })
      return {
        content: `MCP tool "${entry.rawName}" failed (${retryMessage}). It may have already executed; do not repeat this call without confirming with the user.`,
        isError: true,
        provenance: "web-untrusted"
      }
    }
  }
}
