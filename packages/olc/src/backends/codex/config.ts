/** Configuration owned by the Codex app-server backend. */
import os from "node:os"
import path from "node:path"
import { type ProxyOptions, stringOption } from "../../config.js"

export const CODEX_DEFAULTS = {
  CODEX_PATH: "codex",
  PROJECT_DIR: path.join(os.tmpdir(), "olc-codex-workspace"),
  WEB_SEARCH_MODE: "cached"
} as const

export type CodexWebSearchMode = "disabled" | "cached" | "indexed" | "live"

const CODEX_WEB_SEARCH_MODES: readonly CodexWebSearchMode[] = [
  "disabled",
  "cached",
  "indexed",
  "live"
]

export interface CodexConfig {
  CODEX_PATH: string
  PROJECT_DIR: string
  WEB_SEARCH_MODE: CodexWebSearchMode
}

export const resolveCodexConfig = ({
  options = {},
  fileOptions = {}
}: {
  options?: ProxyOptions
  fileOptions?: ProxyOptions
} = {}): CodexConfig => {
  const env = process.env
  const webSearchMode = stringOption(
    options.CODEX_WEB_SEARCH_MODE,
    env.OLC_CODEX_WEB_SEARCH_MODE,
    fileOptions.CODEX_WEB_SEARCH_MODE,
    CODEX_DEFAULTS.WEB_SEARCH_MODE
  )
  if (!CODEX_WEB_SEARCH_MODES.includes(webSearchMode as CodexWebSearchMode)) {
    throw new Error(
      `Invalid Codex web-search mode '${webSearchMode}'. Expected disabled, cached, indexed, or live.`
    )
  }

  return {
    CODEX_PATH: stringOption(
      options.CODEX_PATH,
      env.OLC_CODEX_PATH,
      env.CODEX_PATH,
      fileOptions.CODEX_PATH,
      CODEX_DEFAULTS.CODEX_PATH
    ),
    PROJECT_DIR: stringOption(
      options.CODEX_PROJECT_DIR,
      options.PROJECT_DIR,
      env.OLC_CODEX_PROJECT_DIR,
      fileOptions.CODEX_PROJECT_DIR,
      fileOptions.PROJECT_DIR,
      CODEX_DEFAULTS.PROJECT_DIR
    ),
    WEB_SEARCH_MODE: webSearchMode as CodexWebSearchMode
  }
}

/**
 * olc is a model proxy: the client brings its own tools, bridged per turn.
 * Codex would otherwise start the operator's plugins and every MCP server in
 * `config.toml` for each thread — about seven processes, none released when
 * an ephemeral thread ends — so a long run exhausted the user's process
 * limit. Plugins are off for the whole app-server; MCP servers are switched
 * off per thread by name, since an override cannot empty the table.
 */
export const CODEX_ISOLATION_OVERRIDES = ["features.plugins=false"] as const

/** `mcp_servers.<name>.enabled = false` for every server `config/read` lists. */
export const codexMcpIsolation = (
  configRead: unknown
): Record<string, false> => {
  const config =
    configRead && typeof configRead === "object" && "config" in configRead
      ? (configRead as { config: unknown }).config
      : undefined
  const servers =
    config && typeof config === "object" && "mcp_servers" in config
      ? (config as { mcp_servers: unknown }).mcp_servers
      : undefined
  if (!servers || typeof servers !== "object" || Array.isArray(servers))
    return {}
  return Object.fromEntries(
    Object.keys(servers).map((name) => [`mcp_servers.${name}.enabled`, false])
  )
}

/**
 * The operator's own MCP servers, switched off for every thread olc starts.
 * Names come from the app-server's merged config, so a server added to
 * `config.toml` is covered without olc knowing it. One listing at a time —
 * concurrent turns share it — and only a success is kept: a failed start or
 * listing is the case that lets the operator's servers run, so the next
 * thread asks again, and a stuck promise can never outlive the failure.
 */
export const createCodexMcpIsolationLoader = ({
  start,
  read,
  log,
  now = Date.now,
  ttlMs = 30_000
}: {
  start: () => Promise<void>
  read: () => Promise<unknown>
  log: (message: string, details: Record<string, unknown>) => void
  now?: () => number
  ttlMs?: number
}): (() => Promise<Record<string, false>>) => {
  let cache: { expiresAt: number; overrides: Record<string, false> } | null =
    null
  let inFlight: Promise<Record<string, false>> | null = null
  const listing = async (): Promise<Record<string, false>> => {
    try {
      await start()
      const overrides = codexMcpIsolation(await read())
      cache = { overrides, expiresAt: now() + ttlMs }
      return overrides
    } catch (error) {
      log("Codex MCP servers could not be listed", {
        message: (error as Error).message
      })
      return {}
    } finally {
      inFlight = null
    }
  }
  return () => {
    if (cache && cache.expiresAt > now())
      return Promise.resolve(cache.overrides)
    inFlight ??= listing()
    return inFlight
  }
}
