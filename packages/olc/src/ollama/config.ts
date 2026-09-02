/** Native settings deliberately do not inherit the proxy's port defaults. */
import { isIP } from "node:net"
import { networkInterfaces } from "node:os"
import type { ProxyOptions } from "../config.js"
import { resolveProcessMode } from "../process-mode.js"

export const EXTENSION_ORIGINS = [
  "chrome-extension://*",
  "moz-extension://*",
  "safari-web-extension://*"
]

export interface OllamaOptions {
  host: string
  port: number
  explicitHost: boolean
  origins: string[]
  binary: string
  check: boolean
  json: boolean
  debug: boolean
  detached: boolean
}

/** Accept only addresses on this machine; olc must never manage a remote server. */
function localHost(host: string): boolean {
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1", "::"].includes(host))
    return true
  return (
    isIP(host) !== 0 &&
    Object.values(networkInterfaces())
      .flat()
      .some((item) => item?.address === host)
  )
}

/** Parse Ollama's host[:port] environment syntax, including bracketed IPv6. */
export function parseHost(value: string): { host: string; port: number } {
  const url = new URL(value.includes("://") ? value : `http://${value}`)
  const host = url.hostname.replace(/^\[|\]$/g, "")
  if (
    url.protocol !== "http:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !localHost(host)
  ) {
    throw new Error(
      "OLLAMA_HOST must be a local HTTP bind address (for example 127.0.0.1:11434)."
    )
  }
  return {
    host,
    port: Number(url.port || value.match(/:(\d+)\/?$/)?.[1] || 11434)
  }
}

/** Add extension access without discarding configured browser origins. */
export function mergeOrigins(...values: unknown[]): string[] {
  return [
    ...new Set([
      ...EXTENSION_ORIGINS,
      ...values
        .flatMap((value) =>
          Array.isArray(value)
            ? value.map(String)
            : typeof value === "string"
              ? value.split(",")
              : []
        )
        .map((value) => value.trim())
        .filter(Boolean)
    ])
  ]
}

/** Shared CLI host/port override native env; proxy env/config ports stay isolated. */
export function resolveOllamaOptions(
  options: ProxyOptions,
  file: ProxyOptions = {},
  env: NodeJS.ProcessEnv = process.env
): OllamaOptions {
  if (options.LAN && options.LOCAL)
    throw new Error("Choose --lan or --local, not both.")
  if ((options.LAN || options.LOCAL) && options.BIND_HOST !== undefined)
    throw new Error("Use --host or --lan/--local, not both.")
  const configuredHost = env.OLLAMA_HOST ?? file.OLLAMA_HOST
  const base = parseHost(String(configuredHost || "127.0.0.1:11434"))
  const host = String(
    options.BIND_HOST ??
      (options.LAN ? "0.0.0.0" : options.LOCAL ? "127.0.0.1" : base.host)
  )
  if (!localHost(host))
    throw new Error(
      "--host must name a local interface, localhost, or a wildcard address."
    )
  const port = Number(options.PORT ?? base.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("--port must be an integer from 1 to 65535.")
  return {
    host,
    port,
    explicitHost: Boolean(
      options.LAN ||
        options.LOCAL ||
        options.BIND_HOST !== undefined ||
        configuredHost
    ),
    origins: mergeOrigins(
      env.OLLAMA_ORIGINS,
      env.OLC_ALLOWED_ORIGINS,
      file.OLLAMA_ORIGINS,
      file.ALLOWED_ORIGINS,
      options.ALLOWED_ORIGINS
    ),
    binary: String(
      options.OLLAMA_PATH ?? env.OLC_OLLAMA_PATH ?? file.OLLAMA_PATH ?? "ollama"
    ),
    check: options.CHECK === true,
    json: options.JSON === true,
    ...resolveProcessMode(options, file, env)
  }
}

/** Wildcard binds are probed through loopback, not a routable wildcard URL. */
export function endpoint(host: string, port: number): string {
  const address =
    host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host
  return `http://${address.includes(":") ? `[${address}]` : address}:${port}`
}

/** Format OLLAMA_HOST without losing IPv6 brackets. */
export function bindAddress(host: string, port: number): string {
  return `${host.includes(":") ? `[${host}]` : host}:${port}`
}
