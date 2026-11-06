/**
 * MCP tool source. Registers every enabled user-configured MCP server as a
 * sibling of the internal and web-search sources (see `build-tool-registry.ts`).
 *
 * Tool names are prefixed with the server slug (`wordcraft_open_document`) so
 * two servers can never collide or shadow a built-in. The registry treats this
 * source as non-volatile; the background invalidates it when
 * `STORAGE_KEYS.MCP.SERVERS` changes (see `src/background/startup.ts`).
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

// Bounded per-server discovery so one hung endpoint can't multiply chat setup delay.
const DISCOVERY_DEADLINE_MS = 10_000

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

/**
 * Whether a raw tool name should be exposed to the model. A server with no
 * stored per-tool config exposes everything (pre-discovery default). Once the
 * card has discovered tools, only names present in that list and toggled on are
 * offered; disabled or not-yet-refreshed tools stay hidden.
 */
const isToolEnabled = (server: McpServer, rawName: string): boolean => {
  const stored = server.tools
  if (!stored) return true
  const entry = stored.find((e) => e.name === rawName)
  return !!entry && entry.enabled
}

// Bounded, abortable discovery of one server's tools.
const discoverServer = async (server: McpServer): Promise<McpTool[]> => {
  const client = clientFor(server)
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new Error("MCP discovery deadline")),
    DISCOVERY_DEADLINE_MS
  )
  try {
    await client.ensureInitialized(controller.signal)
    return await client.listTools(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

export const createMcpToolSource = (): ToolSource => ({
  id: "mcp",
  volatile: false,
  listTools: async () => {
    const servers = await readSetting(SETTINGS.MCP_SERVERS)
    toolIndex.clear()
    const out: ToolDefinition[] = []
    const seenNames = new Set<string>()
    // Discover every enabled server in parallel so one slow or hung endpoint can't
    // multiply the setup delay; each is bounded by its own deadline.
    const discovered = await Promise.all(
      servers
        .filter((server) => server.enabled)
        .map(async (server) => {
          try {
            return { server, tools: await discoverServer(server) }
          } catch (error) {
            logger.warn("MCP server failed to list tools", "McpToolSource", {
              serverId: server.id,
              error: error instanceof Error ? error.message : String(error)
            })
            return null
          }
        })
    )
    for (const entry of discovered) {
      if (!entry) continue
      for (const tool of entry.tools) {
        if (!isToolEnabled(entry.server, tool.name)) continue
        let name = mcpToolName(mcpSlug(entry.server.name), tool.name)
        // Dedup across servers so two servers can't share a tool name and routing
        // never misroutes. Leave room inside the 64-char limit for the suffix.
        if (seenNames.has(name)) {
          const head = name.slice(0, 58)
          let n = 2
          while (seenNames.has(`${head}_${n}`)) n += 1
          name = `${head}_${n}`
        }
        seenNames.add(name)
        out.push({ ...toToolDefinition(entry.server, tool), name })
        toolIndex.set(name, { server: entry.server, rawName: tool.name })
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
    const { content, isError } = await client.callTool(
      entry.rawName,
      args,
      ctx.signal
    )
    return { content, isError, provenance: "web-untrusted" }
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
      const { content, isError } = await client.callTool(
        entry.rawName,
        args,
        ctx.signal
      )
      return { content, isError, provenance: "web-untrusted" }
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
