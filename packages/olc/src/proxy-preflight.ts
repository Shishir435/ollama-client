/**
 * Port-conflict reporting for agent-proxy launches.
 *
 * A bind failure used to reach the user as `EADDRINUSE` plus a log path, which
 * says neither what holds the port nor what to do about it. This binds the port
 * first and, when it is genuinely taken, reports the occupant by name —
 * including whether it is another olc proxy, which is the common case —
 * alongside a port that is actually free.
 *
 * Two rules shape the rest of this module. Nothing here stops or signals a
 * process: a launch that cannot have the port it asked for fails and leaves the
 * machine as it found it. And nothing a stranger supplied is printed as it
 * arrived: the occupant's own service document and its process name are both
 * written by whatever holds the port, so both are sanitized before they reach a
 * terminal that would otherwise execute the escape sequences in them.
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

/** A backend id is an identifier, so anything else is not one — not even quoted. */
const BACKEND_ID = /^[a-z][a-z0-9-]{0,31}$/

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

/**
 * Bind the port for real and report why that failed, if it did.
 *
 * The distinction matters to the user: `EADDRINUSE` means another port would
 * work, while an unusable host or a privileged port means no port will, and
 * sending them to retry on 8085 would waste their time.
 */
export async function probeBind(
  host: string,
  port: number
): Promise<NodeJS.ErrnoException | undefined> {
  const server = createServer()
  return new Promise<NodeJS.ErrnoException | undefined>((resolve) => {
    server.once("error", (error: NodeJS.ErrnoException) => resolve(error))
    server.listen(port, host, () => server.close(() => resolve(undefined)))
  })
}

export interface PreflightDependencies {
  listeners: (port: number) => Promise<Listener[]>
  probe: (url: string) => Promise<OlcService | undefined>
  bind: (
    host: string,
    port: number
  ) => Promise<NodeJS.ErrnoException | undefined>
}

const dependencies: PreflightDependencies = {
  listeners,
  probe: probeOlcService,
  bind: probeBind
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
    if (!(await deps.bind(host, candidate))) return candidate
  }
  return undefined
}

export interface ProxyPortRequest {
  backend: string
  host: string
  port: number
}

/**
 * Resolve before spawning when the address is usable; otherwise throw the
 * message the user needs. Inspection is best effort — an unavailable `lsof`
 * costs the PID, not the diagnosis — so a launch is never blocked on failing to
 * identify an occupant.
 */
export async function assertProxyPortAvailable(
  request: ProxyPortRequest,
  deps: PreflightDependencies = dependencies
): Promise<void> {
  const error = await deps.bind(request.host, request.port)
  if (!error) return
  if (error.code !== "EADDRINUSE")
    throw new Error(describeBindError(request, error))
  throw new Error(await describePortConflict(request, deps))
}

/** An address the machine will never give us is a configuration problem, not a busy port. */
export function describeBindError(
  request: ProxyPortRequest,
  error: NodeJS.ErrnoException
): string {
  const address = `${request.host}:${request.port}`
  if (error.code === "EACCES")
    return `Cannot bind ${address}: permission denied.${request.port < 1024 ? " Ports below 1024 need elevated privileges" : " Something on this machine is refusing the bind"}, so pick a port above 1024 with --port.`
  if (error.code === "EADDRNOTAVAIL" || error.code === "ENOTFOUND")
    return `Cannot bind ${address}: this machine has no such address. Give --host an interface it actually has, or leave it at 127.0.0.1.`
  return `Cannot bind ${address}: ${printable(error.code ?? error.message, 60)}. Check --host and --port.`
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
    const named = BACKEND_ID.test(service.backend) ? service.backend : undefined
    if (named === backend)
      return `It is an olc ${named} proxy${pid} — the extension can use it at ${url} as it is.`
    return named
      ? `It is an olc ${named} proxy${pid}, not ${backend}.`
      : `It is an olc proxy${pid} running some other backend, not ${backend}.`
  }
  if (count > 1) return "Several processes are listening on it."
  if (owner)
    return `It is held by ${printable(path.win32.basename(owner.executable), 40)}${pid}, which did not answer as an olc proxy.`
  return "The process holding it could not be identified."
}

/**
 * Strip what a terminal would act on rather than print.
 *
 * A process name and a service document both come from whoever holds the port,
 * and an escape sequence in either could rewrite this message, or reach further
 * into terminals that answer OSC queries.
 */
function printable(value: string, limit: number): string {
  const stripped = value
    // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .trim()
  if (!stripped) return "an unnamed process"
  return stripped.length > limit ? `${stripped.slice(0, limit)}…` : stripped
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
