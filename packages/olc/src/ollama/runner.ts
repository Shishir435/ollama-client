/** Native Ollama lifecycle policy, with injectable OS ports for side-effect-free tests. */

import { setTimeout as delay } from "node:timers/promises"
import type { ForegroundSession } from "../foreground-process.js"
import {
  endpoint,
  mergeOrigins,
  type OllamaOptions,
  parseHost
} from "./config.js"
import {
  applyManager,
  detectManager,
  type Manager,
  type ManagerRun,
  managerEnvironment,
  prepareManager
} from "./manager.js"
import { assertOllamaListeners, type Listener, listeners } from "./process.js"

export interface Probe {
  ready: boolean
  version?: string
}
export interface OllamaResult {
  session?: ForegroundSession
  backend: "ollama"
  ready: boolean
  status: "ready" | "not-ready" | "started" | "restarted"
  url: string
  host: string
  port: number
  message: string
}

/** Prove native API identity and extension CORS without inference or redirects. */
export async function probeOllama(
  url: string,
  origins: string[] = mergeOrigins()
): Promise<Probe> {
  try {
    for (const pattern of origins) {
      const origin =
        pattern === "*"
          ? "https://olc-check.invalid"
          : pattern.replaceAll("*", "olc-check")
      const response = await fetch(`${url}/api/version`, {
        headers: { Origin: origin },
        redirect: "error",
        signal: AbortSignal.timeout(1500)
      })
      if (!response.ok) {
        await response.body?.cancel()
        return { ready: false }
      }
      const allowed = response.headers.get("access-control-allow-origin")
      if (allowed !== origin && allowed !== "*") {
        await response.body?.cancel()
        return { ready: false }
      }
      const body = await readVersion(response)
      if (
        !body ||
        typeof body !== "object" ||
        !("version" in body) ||
        typeof body.version !== "string"
      )
        return { ready: false }
    }
    return { ready: true }
  } catch {
    return { ready: false }
  }
}

export interface OllamaDependencies {
  listeners: (port: number) => Promise<Listener[]>
  manager: (listener?: Listener) => Promise<Manager>
  environment: (
    manager: Manager,
    listener?: Listener
  ) => Promise<NodeJS.ProcessEnv>
  prepare: (manager: Manager, options: OllamaOptions) => Promise<void>
  apply: (
    manager: Manager,
    options: OllamaOptions,
    env: NodeJS.ProcessEnv,
    listener?: Listener
  ) => Promise<ManagerRun>
  probe: (url: string, origins?: string[]) => Promise<Probe>
  wait: () => Promise<void>
  warn: (message: string) => void
}
const dependencies: OllamaDependencies = {
  listeners,
  manager: detectManager,
  environment: managerEnvironment,
  prepare: prepareManager,
  apply: applyManager,
  probe: probeOllama,
  wait: () => delay(500),
  warn: (message) => console.error(message)
}

/** Reuse healthy servers; changing access requires a verified listener and its manager. */
export async function runOllama(
  input: OllamaOptions,
  deps: OllamaDependencies = dependencies
): Promise<OllamaResult> {
  const found = await deps.listeners(input.port)
  assertOllamaListeners(found)
  const listener = found[0]
  const options = { ...input }
  if (listener && !options.explicitHost) options.host = listener.host
  let url = endpoint(options.host, options.port)
  const result = (
    ready: boolean,
    status: OllamaResult["status"],
    message: string
  ): OllamaResult => ({
    backend: "ollama",
    ready,
    status,
    url,
    host: options.host,
    port: options.port,
    message
  })
  const bindMatches = !listener || matchesBind(listener.host, options.host)
  if (listener && bindMatches && (await deps.probe(url, options.origins)).ready)
    return result(true, "ready", "reusing native Ollama")
  if (options.check)
    return result(
      false,
      "not-ready",
      "Ollama is stopped, bound differently, or missing extension access; start a standalone server with olc or configure its owner manually"
    )
  const manager = await deps.manager(listener)
  if (
    (manager.kind === "cli" || manager.kind === "mac-app") &&
    listener &&
    options.binary === "ollama"
  )
    options.binary = listener.executable
  if (options.debug) deps.warn(`[Ollama] manager=${manager.kind} target=${url}`)
  await deps.prepare(manager, options)
  const env = await deps.environment(manager, listener)
  options.origins = mergeOrigins(env.OLLAMA_ORIGINS, options.origins)
  if (!listener && !options.explicitHost && env.OLLAMA_HOST) {
    const configured = parseHost(env.OLLAMA_HOST)
    options.host = configured.host
    options.port = configured.port
    url = endpoint(options.host, options.port)
  }
  if (
    options.host !== "127.0.0.1" &&
    options.host !== "localhost" &&
    options.host !== "::1"
  )
    deps.warn(
      "Warning: Ollama LAN access has no authentication. Use a trusted network and firewall."
    )
  if (listener)
    deps.warn(
      "Restarting Ollama to update access. Active generations will be interrupted."
    )
  const run = await deps.apply(manager, options, env, listener)
  return finishStartup(
    options,
    url,
    deps,
    run,
    result(true, listener ? "restarted" : "started", run.detail)
  )
}

/** Go may report its dual-stack wildcard listener as either address family. */
function matchesBind(actual: string, requested: string): boolean {
  return (
    actual === requested ||
    (actual === "127.0.0.1" && requested === "localhost") ||
    (["0.0.0.0", "::"].includes(actual) &&
      ["0.0.0.0", "::"].includes(requested))
  )
}

/** Startup has a finite deadline and verifies the actual listener as well as HTTP. */
async function waitUntilReady(
  options: OllamaOptions,
  url: string,
  deps: OllamaDependencies,
  signal?: AbortSignal
): Promise<boolean> {
  const deadline = Date.now() + 15000
  for (
    let attempt = 0;
    attempt < 30 && Date.now() < deadline && !signal?.aborted;
    attempt++
  ) {
    if ((await deps.probe(url, options.origins)).ready) {
      const actual = await deps.listeners(options.port)
      assertOllamaListeners(actual)
      if (actual[0] && matchesBind(actual[0].host, options.host)) return true
    }
    await deps.wait()
  }
  return false
}

/** A local endpoint must not be able to return an unbounded diagnostic body. */
async function readVersion(response: Response): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 16384) return null
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } finally {
    await reader.cancel()
  }
}

/** A foreground child exiting or a failed startup must not leave an owned server behind. */
async function finishStartup(
  options: OllamaOptions,
  url: string,
  deps: OllamaDependencies,
  run: ManagerRun,
  result: OllamaResult
): Promise<OllamaResult> {
  const controller = new AbortController()
  try {
    const ready = waitUntilReady(options, url, deps, controller.signal)
    const exited = run.session?.finished.then(() => false)
    if (await (exited ? Promise.race([ready, exited]) : ready))
      return { ...result, ...(run.session ? { session: run.session } : {}) }
    throw new Error(
      `Ollama did not become ready at ${url}. Check ${run.detail}; no force-kill or further restart was attempted.`
    )
  } catch (error) {
    run.session?.stop()
    throw error
  } finally {
    controller.abort()
  }
}
