/** Native Ollama lifecycle policy, with injectable OS ports for side-effect-free tests. */

import { setTimeout as delay } from "node:timers/promises"
import type { ForegroundSession } from "../foreground-process.js"
import { readBoundedJson } from "../util.js"
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
      const body = await readBoundedJson(response)
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
  const options = { ...input }
  const found = await deps.listeners(input.port)
  const target = await selectOllamaTarget(input, options, found, deps)
  const { selected, listener } = target
  let { manager, env } = target
  const url = endpoint(options.host, options.port)
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
  try {
    assertOllamaListeners(selected)
  } catch (error) {
    if (!options.check) throw error
    return result(
      false,
      "not-ready",
      "The selected Ollama endpoint is occupied by another process or has ambiguous ownership"
    )
  }
  if (env) options.origins = mergeOrigins(env.OLLAMA_ORIGINS, options.origins)
  if (
    listener &&
    matchesBind(listener.host, options.host) &&
    (await deps.probe(url, options.origins)).ready
  )
    return result(true, "ready", "reusing native Ollama")
  if (options.check)
    return result(
      false,
      "not-ready",
      "Ollama is stopped, bound differently, or missing extension access; start a standalone server with olc or configure its owner manually"
    )
  manager ??= await deps.manager(listener)
  env ??= await deps.environment(manager, listener)
  options.origins = mergeOrigins(env.OLLAMA_ORIGINS, options.origins)
  if (
    (manager.kind === "cli" || manager.kind === "mac-app") &&
    listener &&
    options.binary === "ollama"
  )
    options.binary = listener.executable
  if (options.debug) deps.warn(`[Ollama] manager=${manager.kind} target=${url}`)
  await deps.prepare(manager, options)
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

interface OllamaTarget {
  selected: Listener[]
  listener?: Listener
  manager?: Manager
  env?: NodeJS.ProcessEnv
}

/** Prefer an installed macOS app's configured endpoint before judging the requested port. */
async function selectOllamaTarget(
  input: OllamaOptions,
  options: OllamaOptions,
  found: Listener[],
  deps: OllamaDependencies
): Promise<OllamaTarget> {
  let selected = found
  let listener = selected[0]
  let manager: Manager | undefined
  let env: NodeJS.ProcessEnv | undefined
  if (options.explicitHost)
    return { selected, ...(listener ? { listener } : {}) }
  const installed = await deps.manager(undefined)
  if (installed.kind === "mac-app") {
    const configuredEnv = await deps.environment(installed, undefined)
    if (configuredEnv.OLLAMA_HOST) {
      const configured = parseHost(configuredEnv.OLLAMA_HOST)
      options.host = configured.host
      options.port = configured.port
      selected =
        configured.port === input.port
          ? found
          : await deps.listeners(configured.port)
      listener = selected[0]
      if (listener) {
        manager = await deps.manager(listener)
        env = await deps.environment(manager, listener)
      } else {
        manager = installed
        env = configuredEnv
      }
    }
  }
  if (!manager && listener) options.host = listener.host
  return {
    selected,
    ...(listener ? { listener } : {}),
    ...(manager ? { manager } : {}),
    ...(env ? { env } : {})
  }
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
