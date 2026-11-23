import type {
  ConnectorDraft,
  ConnectorSecretDraft
} from "@ollama-client/contracts/connector-rpc"
import {
  ConnectorHeaderNameSchema,
  ConnectorUrlSchema
} from "@ollama-client/contracts/connector-rpc"

/**
 * The `mcpServers` config every MCP server README ships (Claude Desktop,
 * Cursor; VS Code's `servers` too). Pasting one is how a user adds servers
 * without anyone writing per-server integration: remote entries become
 * connectors directly, local ones go to a bridge config the user runs.
 */

export const BRIDGE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

export interface LocalServerEntry {
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  cwd?: string
}

export interface RemoteServerEntry {
  name: string
  url: string
  headers: Record<string, string>
}

export type SkipReason =
  | "disabled"
  | "invalid_name"
  | "invalid_url"
  | "sse_only"
  | "no_command"

export interface ParsedMcpConfig {
  local: LocalServerEntry[]
  remote: RemoteServerEntry[]
  skipped: Array<{ name: string; reason: SkipReason }>
}

export type McpConfigParseError = "invalid_json" | "no_servers"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

const stringRecord = (value: unknown): Record<string, string> | undefined => {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string"
  )
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

/** Where the server map lives in the shapes people actually paste. */
const findServerMap = (
  root: Record<string, unknown>
): Record<string, unknown> | undefined => {
  if (isRecord(root.mcpServers)) return root.mcpServers
  if (isRecord(root.servers)) return root.servers
  if (isRecord(root.mcp) && isRecord(root.mcp.servers)) return root.mcp.servers
  const values = Object.values(root)
  if (
    values.length > 0 &&
    values.every(
      (value) => isRecord(value) && ("command" in value || "url" in value)
    )
  ) {
    return root
  }
  return undefined
}

export const parseMcpConfig = (
  text: string
): ParsedMcpConfig | { error: McpConfigParseError } => {
  let root: unknown
  try {
    root = JSON.parse(text)
  } catch {
    return { error: "invalid_json" }
  }
  if (!isRecord(root)) return { error: "no_servers" }
  const map = findServerMap(root)
  if (!map || Object.keys(map).length === 0) return { error: "no_servers" }

  const parsed: ParsedMcpConfig = { local: [], remote: [], skipped: [] }
  for (const [name, raw] of Object.entries(map)) {
    if (!isRecord(raw)) continue
    if (raw.disabled === true) {
      parsed.skipped.push({ name, reason: "disabled" })
      continue
    }
    if (typeof raw.url === "string") {
      if (raw.type === "sse") {
        parsed.skipped.push({ name, reason: "sse_only" })
        continue
      }
      if (!ConnectorUrlSchema.safeParse(raw.url).success) {
        parsed.skipped.push({ name, reason: "invalid_url" })
        continue
      }
      parsed.remote.push({
        name,
        url: raw.url,
        headers: stringRecord(raw.headers) ?? {}
      })
      continue
    }
    if (typeof raw.command !== "string" || !raw.command.trim()) {
      parsed.skipped.push({ name, reason: "no_command" })
      continue
    }
    if (!BRIDGE_NAME_PATTERN.test(name)) {
      parsed.skipped.push({ name, reason: "invalid_name" })
      continue
    }
    const args = Array.isArray(raw.args)
      ? raw.args.filter((arg): arg is string => typeof arg === "string")
      : []
    const env = stringRecord(raw.env)
    parsed.local.push({
      name,
      command: raw.command,
      args,
      ...(env ? { env } : {}),
      ...(typeof raw.cwd === "string" ? { cwd: raw.cwd } : {})
    })
  }
  return parsed
}

/**
 * The bridge config for a set of local servers, in the README format so the
 * same file also works with any other MCP client. A later entry with the same
 * name replaces an earlier one.
 */
export const buildBridgeConfig = (
  entries: readonly LocalServerEntry[]
): string => {
  const mcpServers: Record<string, Omit<LocalServerEntry, "name">> = {}
  for (const { name, ...entry } of entries) mcpServers[name] = entry
  return `${JSON.stringify({ mcpServers }, null, 2)}\n`
}

/**
 * A remote entry as a connector draft. One credential header is carried as
 * the connector's secret; a server that needs several headers can't be
 * represented yet and is reported back instead of half-configured.
 */
export const remoteEntryToDraft = (
  entry: RemoteServerEntry
): { draft: ConnectorDraft } | { error: "too_many_headers" } => {
  const headers = Object.entries(entry.headers)
  if (headers.length > 1) return { error: "too_many_headers" }
  let auth: ConnectorDraft["auth"] = { kind: "none" }
  let secret: ConnectorSecretDraft = { state: "unchanged" }
  const [header] = headers
  if (header) {
    const [headerName, value] = header
    const bearer = /^Bearer\s+(.+)$/i.exec(value)
    if (headerName.toLowerCase() === "authorization" && bearer) {
      auth = { kind: "bearer" }
      secret = { state: "replaced", value: bearer[1] }
    } else if (ConnectorHeaderNameSchema.safeParse(headerName).success) {
      auth = { kind: "header", headerName }
      secret = { state: "replaced", value }
    } else {
      return { error: "too_many_headers" }
    }
  }
  return {
    draft: {
      type: "mcp-http",
      name: entry.name.slice(0, 60),
      url: entry.url,
      enabled: true,
      auth,
      secret
    }
  }
}

const sameLaunch = (a: LocalServerEntry, b: LocalServerEntry): boolean =>
  a.command === b.command && JSON.stringify(a.args) === JSON.stringify(b.args)

/**
 * Add an entry to a bridge plan.
 *
 * - `replace`: an entry with the same name is the user's own earlier choice
 *   (a preset with a new folder, a re-pasted config) and is updated.
 * - `unique`: a different server that happens to share the name — two
 *   Registry servers both called `tools` — gets `-2`, `-3`… instead of
 *   silently replacing the first. The same server added again is a no-op.
 */
export const addToBridgePlan = (
  entries: readonly LocalServerEntry[],
  entry: LocalServerEntry,
  mode: "replace" | "unique"
): { entries: LocalServerEntry[]; name: string } => {
  if (mode === "replace") {
    return {
      entries: [...entries.filter((item) => item.name !== entry.name), entry],
      name: entry.name
    }
  }
  const same = entries.find(
    (item) => item.name === entry.name && sameLaunch(item, entry)
  )
  if (same) return { entries: [...entries], name: same.name }
  let name = entry.name
  for (let n = 2; entries.some((item) => item.name === name); n += 1) {
    const suffix = `-${n}`
    name = `${entry.name.slice(0, 64 - suffix.length)}${suffix}`
  }
  return { entries: [...entries, { ...entry, name }], name }
}
