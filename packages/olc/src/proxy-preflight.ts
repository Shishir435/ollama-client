/**
 * Port-conflict reporting for agent-proxy launches.
 *
 * A bind failure used to reach the user as `EADDRINUSE` plus a log path, which
 * says neither what holds the port nor what to do about it. This inspects the
 * port first and reports the occupant by name — including whether it is another
 * olc proxy, which is the common case — alongside a port that is actually free.
 *
 * Nothing here stops or signals a process: a launch that cannot have the port it
 * asked for fails and leaves the machine as it found it.
 */
import { createServer } from "node:http"
import path from "node:path"
import { endpoint } from "./ollama/config.js"
import { type Listener, listeners } from "./ollama/process.js"
import { isRecord, readBoundedJson } from "./util.js"

/** How the `/` service document identifies a running proxy. */
export interface OlcService {
  backend: string
}

const PROBE_TIMEOUT_MS = 1500
const SUGGESTION_RANGE = 20

/** Only a proxy's own unauthenticated service document counts as identification. */
export async function probeOlcService(
  url: string
): Promise<OlcService | undefined> {
  try {
    const response = await fetch(`${url}/`, {
      redirect: "error",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    })
    if (!response.ok) {
      await response.body?.cancel()
      return undefined
    }
    const body = await readBoundedJson(response)
    if (
      !isRecord(body) ||
      body.service !== "olc" ||
      typeof body.backend !== "string"
    )
      return undefined
    return { backend: body.backend }
  } catch {
    return undefined
  }
}

/** A port only counts as free once a real bind on the requested host succeeds. */
export async function isPortFree(host: string, port: number): Promise<boolean> {
  const server = createServer()
  return new Promise<boolean>((resolve) => {
    server.once("error", () => resolve(false))
    server.listen(port, host, () => server.close(() => resolve(true)))
  })
}

export interface PreflightDependencies {
  listeners: (port: number) => Promise<Listener[]>
  probe: (url: string) => Promise<OlcService | undefined>
  free: (host: string, port: number) => Promise<boolean>
}

const dependencies: PreflightDependencies = {
  listeners,
  probe: probeOlcService,
  free: isPortFree
}

/** Suggest a port the user can actually use, rather than telling them to guess. */
export async function findFreePort(
  host: string,
  port: number,
  deps: PreflightDependencies = dependencies
): Promise<number | undefined> {
  for (
    let candidate = port + 1;
    candidate <= Math.min(port + SUGGESTION_RANGE, 65535);
    candidate++
  ) {
    if (await deps.free(host, candidate)) return candidate
  }
  return undefined
}

export interface ProxyPortRequest {
  backend: string
  host: string
  port: number
}

/**
 * Resolve before spawning when the port is usable; otherwise throw the message
 * the user needs. Inspection is best effort — an unavailable `lsof` costs the
 * PID, not the diagnosis — so a launch is never blocked on failing to identify
 * an occupant.
 */
export async function assertProxyPortAvailable(
  request: ProxyPortRequest,
  deps: PreflightDependencies = dependencies
): Promise<void> {
  if (await deps.free(request.host, request.port)) return
  throw new Error(await describePortConflict(request, deps))
}

/** Name the occupant, then name the way forward. */
export async function describePortConflict(
  request: ProxyPortRequest,
  deps: PreflightDependencies = dependencies
): Promise<string> {
  const url = endpoint(request.host, request.port)
  const [service, found] = await Promise.all([
    deps.probe(url),
    inspect(request.port, deps)
  ])
  const owner = found.length === 1 ? found[0] : undefined
  const alternative = await findFreePort(request.host, request.port, deps)
  const retry = alternative
    ? `run this one on a free port: olc -b ${request.backend} --port ${alternative}`
    : "run this one on a free port with --port"
  return [
    `Port ${request.port} is already in use. ${occupant({ service, owner, count: found.length, url, backend: request.backend })}`,
    `${stopHint(owner)}, or ${retry}.`
  ].join("\n     ")
}

/** Say what is there in words the user can act on, and never overstate it. */
function occupant({
  service,
  owner,
  count,
  url,
  backend
}: {
  service: OlcService | undefined
  owner: Listener | undefined
  count: number
  url: string
  backend: string
}): string {
  const pid = owner ? ` (PID ${owner.pid})` : ""
  if (service) {
    return service.backend === backend
      ? `It is an olc ${service.backend} proxy${pid} — the extension can use it at ${url} as it is.`
      : `It is an olc ${service.backend} proxy${pid}, not ${backend}.`
  }
  if (count > 1) return "Several processes are listening on it."
  if (owner)
    return `It is held by ${path.win32.basename(owner.executable)}${pid}, which did not answer as an olc proxy.`
  return "The process holding it could not be identified."
}

/** Stopping the occupant is the user's call, so give them the exact command. */
function stopHint(owner: Listener | undefined): string {
  if (!owner) return "Stop whatever is using it"
  return process.platform === "win32"
    ? `Stop PID ${owner.pid} through Task Manager`
    : `Stop it with \`kill -TERM ${owner.pid}\``
}

/** A platform that cannot inspect listeners still deserves the rest of the report. */
async function inspect(
  port: number,
  deps: PreflightDependencies
): Promise<Listener[]> {
  try {
    return await deps.listeners(port)
  } catch {
    return []
  }
}
