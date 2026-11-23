/** Configuration for `olc mcp`: a file naming the stdio MCP servers to bridge. */
import fs from "node:fs"
import path from "node:path"

export const DEFAULT_MCP_PORT = 8086
export const DEFAULT_MCP_HOST = "127.0.0.1"

/** Names appear in URL paths, so they are restricted to a safe, short alphabet. */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

const SERVER_TYPES = ["stdio", "http", "sse", "streamable-http"]
const SERVER_MAP_KEYS = ["mcpServers", "servers"] as const

export interface McpServerSpec {
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
}

export interface McpBridgeConfig {
  port: number
  host: string
  token?: string
  servers: Record<string, McpServerSpec>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const stderrWarn = (line: string) => void process.stderr.write(`${line}\n`)

/**
 * Validate an already-parsed config; every failure names the offending field.
 * Accepts `mcpServers` (Claude Desktop, Cursor) or `servers` (VS Code), never both.
 * Disabled entries are dropped silently and remote ones are reported through
 * `warn`, since only stdio servers need a bridge.
 */
export function parseMcpConfig(
  raw: unknown,
  baseDir: string = process.cwd(),
  warn: (line: string) => void = stderrWarn
): McpBridgeConfig {
  if (!isRecord(raw)) throw new Error("MCP config must be a JSON object")
  const port = raw.port ?? DEFAULT_MCP_PORT
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new Error('MCP config "port" must be an integer from 1 to 65535')
  const host = raw.host ?? DEFAULT_MCP_HOST
  if (typeof host !== "string" || host.trim() === "")
    throw new Error('MCP config "host" must be a non-empty string')
  const token = raw.token
  if (token !== undefined && (typeof token !== "string" || token === ""))
    throw new Error('MCP config "token" must be a non-empty string')
  const present = SERVER_MAP_KEYS.filter((key) => raw[key] !== undefined)
  if (present.length > 1)
    throw new Error(
      'MCP config must use one of "mcpServers" or "servers", not both'
    )
  const key = present[0]
  const map = key === undefined ? undefined : raw[key]
  if (key === undefined || !isRecord(map))
    throw new Error(
      `MCP config "${key ?? "mcpServers"}" must be an object of servers`
    )

  const servers: Record<string, McpServerSpec> = {}
  for (const name of Object.keys(map)) {
    const entry = map[name]
    if (isRecord(entry) && entry.disabled === true) continue
    if (isRemote(entry)) {
      warn(
        `skipped ${name}: remote server — add its URL in the extension directly`
      )
      continue
    }
    if (!SERVER_NAME_PATTERN.test(name))
      throw new Error(
        `Invalid MCP server name "${name}": use letters, digits, "_", "." and "-" (1-64 characters, starting with a letter or digit)`
      )
    servers[name] = parseServer(name, entry, baseDir)
  }
  if (Object.keys(servers).length === 0)
    throw new Error(
      `MCP config "${key}" must define at least one stdio server with a "command"`
    )
  return { port, host, ...(token === undefined ? {} : { token }), servers }
}

/** A remote entry has a URL or a non-stdio type; the extension connects to it directly. */
function isRemote(entry: unknown): boolean {
  if (!isRecord(entry)) return false
  if (entry.url !== undefined) return true
  return typeof entry.type === "string" && entry.type !== "stdio"
    ? SERVER_TYPES.includes(entry.type)
    : false
}

function parseServer(
  name: string,
  raw: unknown,
  baseDir: string
): McpServerSpec {
  if (!isRecord(raw)) throw new Error(`MCP server "${name}" must be an object`)
  const { command, args, env, cwd, type } = raw
  if (type !== undefined && !SERVER_TYPES.includes(type as string))
    throw new Error(
      `MCP server "${name}": "type" must be one of ${SERVER_TYPES.join(", ")}`
    )
  if (typeof command !== "string" || command.trim() === "")
    throw new Error(
      `MCP server "${name}": "command" must be a non-empty string`
    )
  if (
    args !== undefined &&
    (!Array.isArray(args) || args.some((arg) => typeof arg !== "string"))
  )
    throw new Error(`MCP server "${name}": "args" must be an array of strings`)
  if (
    env !== undefined &&
    (!isRecord(env) || Object.values(env).some((v) => typeof v !== "string"))
  )
    throw new Error(
      `MCP server "${name}": "env" must be an object of string values`
    )
  if (cwd !== undefined && (typeof cwd !== "string" || cwd === ""))
    throw new Error(`MCP server "${name}": "cwd" must be a non-empty string`)
  return {
    command,
    args: (args as string[] | undefined) ?? [],
    env: (env as Record<string, string> | undefined) ?? {},
    ...(cwd === undefined ? {} : { cwd: path.resolve(baseDir, cwd) })
  }
}

/** Read and validate a config file; relative `cwd` values resolve against its directory. */
export function loadMcpConfig(
  file: string,
  warn?: (line: string) => void
): McpBridgeConfig {
  const resolved = path.resolve(file)
  let text: string
  try {
    text = fs.readFileSync(resolved, "utf8")
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Cannot read MCP config ${resolved}: ${reason}`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error(`MCP config ${resolved} is not valid JSON`)
  }
  return parseMcpConfig(raw, path.dirname(resolved), warn)
}
