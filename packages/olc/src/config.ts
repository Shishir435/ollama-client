/**
 * Resolves the proxy core's configuration, and exports the option helpers backends
 * use to resolve their own.
 *
 * Precedence is command line, then environment, then config file, then default.
 * A config file is the installed baseline and the environment is what an operator
 * changes for one run, so a file that outranked `OLC_PORT` would silently ignore the
 * override.
 *
 * Note: the bridge token defaults to a fresh random value per run and is only handed
 * to the backend runtime, so nothing else on the loopback interface can post tool
 * results into a live turn.
 *
 * `ALLOWED_ORIGINS` defaults to the extension schemes rather than to everything: the
 * clients this proxy exists for are browser extensions, and an ordinary web page
 * reaching a loopback agent is the thing the default has to refuse.
 */
import { randomBytes } from "node:crypto"
import type { ProxyConfig } from "./types.js"
import { parseBool, parseList } from "./util.js"

export const PROXY_DEFAULT_PORTS = { codex: 8083, opencode: 8084 } as const

export const DEFAULTS = {
  PORT: PROXY_DEFAULT_PORTS.opencode,
  BIND_HOST: "127.0.0.1",
  BACKEND: "opencode",
  ALLOWED_ORIGINS: [
    "chrome-extension://*",
    "moz-extension://*",
    "safari-web-extension://*"
  ],
  REQUEST_TIMEOUT_MS: 1_800_000,
  BRIDGE_PATH: "/bridge/call",
  BRIDGE_CALL_TIMEOUT_MS: 300_000,
  BRIDGE_BATCH_MS: 150,
  SUSPENDED_TURN_TTL_MS: 600_000
} as const

/** Options as they arrive from a config file or the command line. */
export type ProxyOptions = Record<string, unknown>

export const numberOption = (...candidates: unknown[]): number => {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === "") {
      continue
    }
    const value = Number(candidate)
    if (Number.isFinite(value) && value >= 0) return value
  }
  return 0
}

export const stringOption = (...candidates: unknown[]): string => {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate
    }
  }
  return ""
}

export const boolOption = (
  candidates: unknown[],
  fallback: boolean
): boolean => {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === "") {
      continue
    }
    return parseBool(candidate, fallback)
  }
  return fallback
}

export const listOption = (candidates: unknown[]): string[] => {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === "") {
      continue
    }
    const parsed = parseList(candidate, [])
    if (parsed.length > 0) return parsed
  }
  return []
}

/** The loopback address a backend runtime should use to reach this proxy. */
export const loopbackHost = (host: string): string =>
  host === "127.0.0.1" || host === "localhost" || host === "::1"
    ? host
    : "127.0.0.1"

export const resolveConfig = (
  options: ProxyOptions = {},
  fileOptions: ProxyOptions = {}
): ProxyConfig => {
  const env = process.env
  const backend = stringOption(
    options.BACKEND,
    env.OLC_BACKEND,
    fileOptions.BACKEND,
    DEFAULTS.BACKEND
  )
  const backendPort =
    backend === "codex"
      ? PROXY_DEFAULT_PORTS.codex
      : PROXY_DEFAULT_PORTS.opencode
  const port = numberOption(
    options.PORT,
    env.OLC_PORT,
    env.OPENCODE_PROXY_PORT,
    fileOptions.PORT,
    backendPort
  )
  const bindHost = stringOption(
    options.BIND_HOST,
    env.OLC_BIND_HOST,
    env.OPENCODE_PROXY_BIND_HOST,
    fileOptions.BIND_HOST,
    DEFAULTS.BIND_HOST
  )
  const allowedOrigins = listOption([
    options.ALLOWED_ORIGINS,
    env.OLC_ALLOWED_ORIGINS,
    fileOptions.ALLOWED_ORIGINS
  ])
  const bridgePath = stringOption(
    options.BRIDGE_PATH,
    fileOptions.BRIDGE_PATH,
    DEFAULTS.BRIDGE_PATH
  )

  return {
    PORT: port,
    BIND_HOST: bindHost,
    API_KEY: stringOption(
      options.API_KEY,
      env.OLC_API_KEY,
      env.OPENCODE_PROXY_API_KEY,
      fileOptions.API_KEY
    ),
    SYSTEM_PROMPT: stringOption(
      options.SYSTEM_PROMPT,
      env.OLC_SYSTEM_PROMPT,
      fileOptions.SYSTEM_PROMPT
    ),
    BACKEND: backend,
    ALLOWED_ORIGINS:
      allowedOrigins.length > 0
        ? allowedOrigins
        : [...DEFAULTS.ALLOWED_ORIGINS],
    REQUEST_TIMEOUT_MS: numberOption(
      options.REQUEST_TIMEOUT_MS,
      env.OLC_REQUEST_TIMEOUT_MS,
      env.OPENCODE_PROXY_REQUEST_TIMEOUT_MS,
      fileOptions.REQUEST_TIMEOUT_MS,
      DEFAULTS.REQUEST_TIMEOUT_MS
    ),
    BRIDGE_ENABLED: boolOption(
      [
        options.BRIDGE_ENABLED,
        env.OLC_BRIDGE_ENABLED,
        fileOptions.BRIDGE_ENABLED
      ],
      true
    ),
    BRIDGE_PATH: bridgePath,
    BRIDGE_TOKEN: stringOption(
      options.BRIDGE_TOKEN,
      env.OLC_BRIDGE_TOKEN,
      fileOptions.BRIDGE_TOKEN,
      randomBytes(24).toString("hex")
    ),
    BRIDGE_ENDPOINT: `http://${loopbackHost(bindHost)}:${port}${bridgePath}`,
    BRIDGE_CALL_TIMEOUT_MS: numberOption(
      options.BRIDGE_CALL_TIMEOUT_MS,
      env.OLC_BRIDGE_CALL_TIMEOUT_MS,
      fileOptions.BRIDGE_CALL_TIMEOUT_MS,
      DEFAULTS.BRIDGE_CALL_TIMEOUT_MS
    ),
    BRIDGE_BATCH_MS: numberOption(
      options.BRIDGE_BATCH_MS,
      env.OLC_BRIDGE_BATCH_MS,
      fileOptions.BRIDGE_BATCH_MS,
      DEFAULTS.BRIDGE_BATCH_MS
    ),
    SUSPENDED_TURN_TTL_MS: numberOption(
      options.SUSPENDED_TURN_TTL_MS,
      env.OLC_SUSPENDED_TURN_TTL_MS,
      fileOptions.SUSPENDED_TURN_TTL_MS,
      DEFAULTS.SUSPENDED_TURN_TTL_MS
    ),
    DEBUG: boolOption(
      [
        options.DEBUG,
        env.OLC_DEBUG,
        env.OPENCODE_PROXY_DEBUG,
        fileOptions.DEBUG
      ],
      false
    )
  }
}
