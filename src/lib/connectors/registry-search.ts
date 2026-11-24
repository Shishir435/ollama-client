import type { LocalServerEntry, RemoteServerEntry } from "./mcp-config"
import { BRIDGE_NAME_PATTERN } from "./mcp-config"

/**
 * Search the official MCP Registry and turn each hit into something this
 * extension can add: a local entry for the bridge config, or a remote URL.
 *
 * Opt-in only. The query goes to a third party, so the settings page sends it
 * on an explicit search, never as the user types or in the background.
 */

export const MCP_REGISTRY_ORIGIN = "https://registry.modelcontextprotocol.io"
const SEARCH_PATH = "/v0/servers"
const MAX_RESULTS = 20
const MAX_BODY_CHARS = 2 * 1024 * 1024

export interface RegistryEnvVar {
  name: string
  description?: string
  required: boolean
  secret: boolean
}

export type RegistryInstall =
  | { kind: "local"; entry: LocalServerEntry; env: RegistryEnvVar[] }
  | {
      kind: "remote"
      entry: RemoteServerEntry
      headers: RegistryEnvVar[]
    }
  | { kind: "unsupported" }

export interface RegistryResult {
  name: string
  title?: string
  description?: string
  version?: string
  repository?: string
  install: RegistryInstall
}

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined

/** `io.github.owner/server-name` -> `server-name`, valid as a bridge key. */
export const bridgeNameFor = (registryName: string): string => {
  const tail = registryName.split("/").pop() ?? registryName
  const cleaned = tail
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 64)
  return BRIDGE_NAME_PATTERN.test(cleaned) ? cleaned : "server"
}

/**
 * Registry arguments as argv. A positional or named argument with no value
 * and no default becomes its `valueHint` in angle brackets, for the user to
 * replace in the generated file, rather than being dropped silently.
 */
const argv = (args: unknown): string[] => {
  if (!Array.isArray(args)) return []
  const out: string[] = []
  for (const raw of args) {
    if (!isRecord(raw)) continue
    const resolved =
      str(raw.value) ??
      str(raw.default) ??
      (raw.isRequired === true
        ? `<${str(raw.valueHint) ?? str(raw.name) ?? "value"}>`
        : undefined)
    if (raw.type === "named") {
      const name = str(raw.name)
      if (!name) continue
      if (resolved !== undefined) out.push(name, resolved)
      else if (raw.isRequired === true) out.push(name)
      continue
    }
    if (resolved !== undefined) out.push(resolved)
  }
  return out
}

const envVars = (list: unknown): RegistryEnvVar[] =>
  Array.isArray(list)
    ? list.filter(isRecord).flatMap((raw) => {
        const name = str(raw.name)
        if (!name) return []
        return [
          {
            name,
            ...(str(raw.description)
              ? { description: str(raw.description) }
              : {}),
            required: raw.isRequired === true,
            secret: raw.isSecret === true
          }
        ]
      })
    : []

const localInstall = (
  serverName: string,
  pkg: Json
): RegistryInstall | undefined => {
  const transport = isRecord(pkg.transport) ? str(pkg.transport.type) : "stdio"
  if (transport !== "stdio") return undefined
  const identifier = str(pkg.identifier)
  if (!identifier) return undefined
  const version = str(pkg.version)
  const runtimeArgs = argv(pkg.runtimeArguments)
  const packageArgs = argv(pkg.packageArguments)
  const env = envVars(pkg.environmentVariables)
  const name = bridgeNameFor(serverName)
  const envBlock = env.length
    ? {
        env: Object.fromEntries(
          env.map((variable) => [variable.name, `<${variable.name}>`])
        )
      }
    : {}

  switch (pkg.registryType) {
    case "npm":
      return {
        kind: "local",
        env,
        entry: {
          name,
          command: "npx",
          args: [
            ...(runtimeArgs.length ? runtimeArgs : ["-y"]),
            version ? `${identifier}@${version}` : identifier,
            ...packageArgs
          ],
          ...envBlock
        }
      }
    case "pypi":
      return {
        kind: "local",
        env,
        entry: {
          name,
          command: "uvx",
          args: [
            ...runtimeArgs,
            version ? `${identifier}==${version}` : identifier,
            ...packageArgs
          ],
          ...envBlock
        }
      }
    case "oci":
      return {
        kind: "local",
        env,
        entry: {
          name,
          command: "docker",
          args: [
            "run",
            "-i",
            "--rm",
            ...runtimeArgs,
            ...env.flatMap((variable) => ["-e", variable.name]),
            identifier,
            ...packageArgs
          ],
          ...envBlock
        }
      }
    default:
      return undefined
  }
}

const remoteInstall = (
  serverName: string,
  remote: Json
): RegistryInstall | undefined => {
  const url = str(remote.url)
  if (remote.type !== "streamable-http" || !url || url.includes("{")) {
    return undefined
  }
  return {
    kind: "remote",
    entry: { name: bridgeNameFor(serverName), url, headers: {} },
    headers: envVars(remote.headers)
  }
}

/** Prefer something that runs locally; fall back to a remote endpoint. */
const installFor = (server: Json): RegistryInstall => {
  const name = str(server.name) ?? "server"
  for (const pkg of Array.isArray(server.packages) ? server.packages : []) {
    if (!isRecord(pkg)) continue
    const install = localInstall(name, pkg)
    if (install) return install
  }
  for (const remote of Array.isArray(server.remotes) ? server.remotes : []) {
    if (!isRecord(remote)) continue
    const install = remoteInstall(name, remote)
    if (install) return install
  }
  return { kind: "unsupported" }
}

export const parseRegistryResponse = (payload: unknown): RegistryResult[] => {
  const items =
    isRecord(payload) && Array.isArray(payload.servers) ? payload.servers : []
  const byName = new Map<string, RegistryResult>()
  for (const item of items) {
    if (!isRecord(item)) continue
    const server = isRecord(item.server) ? item.server : item
    const name = str(server.name)
    if (!name) continue
    const official =
      isRecord(item._meta) &&
      isRecord(item._meta["io.modelcontextprotocol.registry/official"])
        ? item._meta["io.modelcontextprotocol.registry/official"]
        : undefined
    /** Search returns every published version; keep only the latest. */
    if (official && official.isLatest === false) continue
    if (official && str(official.status) && official.status !== "active") {
      continue
    }
    if (byName.has(name)) continue
    const repository = isRecord(server.repository)
      ? str(server.repository.url)
      : undefined
    byName.set(name, {
      name,
      ...(str(server.title) ? { title: str(server.title) } : {}),
      ...(str(server.description)
        ? { description: str(server.description)?.slice(0, 500) }
        : {}),
      ...(str(server.version) ? { version: str(server.version) } : {}),
      ...(repository?.startsWith("https://") ? { repository } : {}),
      install: installFor(server)
    })
  }
  return [...byName.values()].slice(0, MAX_RESULTS)
}

export const searchMcpRegistry = async (
  query: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init)
): Promise<RegistryResult[]> => {
  const url = new URL(SEARCH_PATH, MCP_REGISTRY_ORIGIN)
  url.searchParams.set("search", query.trim().slice(0, 100))
  url.searchParams.set("limit", "50")
  const response = await fetchImpl(url.toString(), {
    headers: { Accept: "application/json" },
    credentials: "omit",
    signal
  })
  if (!response.ok) throw new Error(`MCP Registry returned ${response.status}`)
  const text = await response.text()
  if (text.length > MAX_BODY_CHARS)
    throw new Error("MCP Registry reply too large")
  return parseRegistryResponse(JSON.parse(text))
}
