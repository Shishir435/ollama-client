/** One stdio MCP server process, lazily spawned and exposed as request/response calls. */
import { type ChildProcess, execFile, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import type { McpServerSpec } from "./config.js"
import { resolveLaunch, spawnEnvironment } from "./launch.js"

export type JsonRpcId = string | number

export interface JsonRpcMessage {
  jsonrpc: "2.0"
  id?: JsonRpcId
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/** Why a call to the child did not produce a response. */
export class ChildError extends Error {
  constructor(
    readonly kind: "exit" | "timeout" | "write",
    message: string
  ) {
    super(message)
    this.name = "ChildError"
  }
}

export interface ChildOptions {
  name: string
  spec: McpServerSpec
  timeoutMs: number
  debug: boolean
  /** Receives complete, already-prefixed diagnostic lines. */
  log: (line: string) => void
  /** Defaults to the host platform; decides how the process is stopped. */
  platform?: NodeJS.Platform
  /** Stops a Windows process tree; defaults to `taskkill`. */
  killTree?: (pid: number, force: boolean) => void
}

/**
 * `cmd.exe` shims start the real server as a grandchild, so ending the tracked
 * process alone would orphan it. `/T` takes the whole tree; `/F` is the
 * escalation. No shell is involved.
 */
export const taskkillArgs = (pid: number, force: boolean): string[] => [
  "/pid",
  String(pid),
  "/T",
  ...(force ? ["/F"] : [])
]

const defaultKillTree = (pid: number, force: boolean): void => {
  execFile("taskkill", taskkillArgs(pid, force), () => undefined)
}

interface Pending {
  resolve: (message: JsonRpcMessage) => void
  reject: (error: ChildError) => void
  timer: NodeJS.Timeout
  clientId: JsonRpcId | undefined
}

/** Largest unterminated stdout line kept before the child is considered broken. */
const MAX_LINE_BYTES = 64 * 1024 * 1024
const KILL_GRACE_MS = 2000
/**
 * Node can emit `exit` before stdout is fully read. In-flight requests are
 * failed when stdio closes, or after this bound if a grandchild keeps the pipes
 * open.
 */
const DRAIN_GRACE_MS = 500

export class StdioChild {
  /** Stable for one process lifetime; undefined while no process is alive. */
  sessionId: string | undefined
  /** Result of the one `initialize` the child has seen, shared with later clients. */
  initialize: Promise<JsonRpcMessage> | undefined
  initializedForwarded = false

  private proc: ChildProcess | undefined
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  /**
   * Client request id to the bridge ids in flight under it. Every HTTP client
   * shares this one process and session, and MCP carries no caller identity, so
   * two clients can legitimately both be using id 1.
   */
  private readonly inflight = new Map<JsonRpcId, Set<number>>()
  /** Settles once the current process has exited (or never started). */
  private exited: Promise<void> = Promise.resolve()

  constructor(private readonly options: ChildOptions) {}

  get alive(): boolean {
    return this.proc !== undefined
  }

  /** Spawn if needed; a fresh process gets a fresh session and a clean handshake. */
  ensureStarted(): void {
    if (this.proc) return
    const { name, spec } = this.options
    let proc: ChildProcess
    try {
      const environment = spawnEnvironment(spec)
      const launch = resolveLaunch(spec.command, spec.args, environment)
      proc = spawn(launch.command, launch.args, {
        cwd: spec.cwd,
        env: environment.env,
        shell: false,
        windowsVerbatimArguments: launch.windowsVerbatimArguments,
        stdio: ["pipe", "pipe", "pipe"]
      })
    } catch (error) {
      this.options.log(
        `[${name}] cannot start: ${error instanceof Error ? error.message : String(error)}`
      )
      return
    }
    this.proc = proc
    this.exited = new Promise((resolve) => {
      proc.once("exit", () => resolve())
      proc.once("error", () => {
        if (proc.pid === undefined) resolve()
      })
    })
    this.sessionId = randomUUID()
    this.initialize = undefined
    this.initializedForwarded = false
    this.options.log(`[${name}] started: ${spec.command}`)

    let stdoutBuffer = ""
    proc.stdout?.setEncoding("utf8")
    proc.stdout?.on("end", () => {
      /** A final response may lack its trailing newline. */
      if (stdoutBuffer !== "") this.handleLine(proc, stdoutBuffer)
      stdoutBuffer = ""
    })
    proc.stdout?.on("data", (chunk: string) => {
      stdoutBuffer += chunk
      let newline = stdoutBuffer.indexOf("\n")
      while (newline >= 0) {
        this.handleLine(proc, stdoutBuffer.slice(0, newline))
        stdoutBuffer = stdoutBuffer.slice(newline + 1)
        newline = stdoutBuffer.indexOf("\n")
      }
      if (stdoutBuffer.length > MAX_LINE_BYTES) {
        this.options.log(`[${name}] stdout line too large; stopping server`)
        stdoutBuffer = ""
        this.kill(proc)
      }
    })
    let stderrBuffer = ""
    proc.stderr?.setEncoding("utf8")
    proc.stderr?.on("data", (chunk: string) => {
      stderrBuffer += chunk
      const lines = stderrBuffer.split("\n")
      stderrBuffer = lines.pop() ?? ""
      for (const line of lines) this.options.log(`[${name}] ${line}`)
    })
    proc.stderr?.on("end", () => {
      if (stderrBuffer) this.options.log(`[${name}] ${stderrBuffer}`)
      stderrBuffer = ""
    })

    /** Stream errors (EPIPE, reset) must never become uncaught exceptions. */
    for (const stream of [proc.stdin, proc.stdout, proc.stderr])
      stream?.on("error", (error) =>
        this.options.log(`[${name}] stream error: ${error.message}`)
      )
    proc.on("error", (error) => {
      this.options.log(`[${name}] process error: ${error.message}`)
      /** A spawn failure never reaches `exit`; a live process's error is only logged. */
      if (proc.pid === undefined) this.died(proc, error.message)
    })
    const describe = (code: number | null, signal: NodeJS.Signals | null) =>
      `exited (${signal ?? `code ${code}`})`
    proc.on("exit", (code, signal) => {
      setTimeout(
        () => this.died(proc, describe(code, signal)),
        DRAIN_GRACE_MS
      ).unref()
    })
    /** Fires after stdio has drained, so buffered responses are delivered first. */
    proc.on("close", (code, signal) => this.died(proc, describe(code, signal)))
  }

  /** Send a request under a bridge-unique id and wait for the matching response. */
  request(message: JsonRpcMessage): Promise<JsonRpcMessage> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const clientId = message.id
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.forget(clientId, id)
        reject(
          new ChildError(
            "timeout",
            `${this.options.name} did not answer within ${this.options.timeoutMs} ms`
          )
        )
      }, this.options.timeoutMs)
      this.pending.set(id, { resolve, reject, timer, clientId })
      if (clientId !== undefined) {
        const ids = this.inflight.get(clientId) ?? new Set<number>()
        ids.add(id)
        this.inflight.set(clientId, ids)
      }
      this.write({ ...message, id }, (error) => {
        if (this.pending.delete(id)) {
          clearTimeout(timer)
          this.forget(clientId, id)
          reject(error)
        }
      })
    })
  }

  /** Forward a message that expects no reply. */
  notify(message: JsonRpcMessage): void {
    this.write(message, (error) =>
      this.options.log(`[${this.options.name}] ${error.message}`)
    )
  }

  /**
   * Forward `notifications/cancelled` with the child's own id for the request.
   * Returns false, forwarding nothing, when the client's request is not in flight.
   *
   * The bridge has no reliable per-caller identity: `Mcp-Session-Id` is shared
   * by every client and HTTP connections are neither one-per-caller nor stable
   * across a caller's requests. When the same client id is in flight more than
   * once, the cancellation could belong to either caller, so it is dropped
   * rather than guessed; the requests then finish or time out on their own.
   */
  cancel(message: JsonRpcMessage): boolean {
    const params = message.params
    if (typeof params !== "object" || params === null) return false
    const requestId = (params as { requestId?: unknown }).requestId
    if (typeof requestId !== "string" && typeof requestId !== "number")
      return false
    const ids = this.inflight.get(requestId)
    if (ids?.size !== 1) return false
    const [bridgeId] = ids
    this.notify({ ...message, params: { ...params, requestId: bridgeId } })
    return true
  }

  /**
   * Stop the process and fail whatever is waiting on it. Resolves only after the
   * process has exited, escalating from SIGTERM to SIGKILL, so a caller that
   * exits next does not orphan it.
   */
  stop(): Promise<void> {
    const proc = this.proc
    return proc ? this.kill(proc) : Promise.resolve()
  }

  private forget(clientId: JsonRpcId | undefined, bridgeId: number): void {
    if (clientId === undefined) return
    const ids = this.inflight.get(clientId)
    if (!ids) return
    ids.delete(bridgeId)
    if (ids.size === 0) this.inflight.delete(clientId)
  }

  private write(
    message: JsonRpcMessage,
    onFailure: (error: ChildError) => void
  ): void {
    const stdin = this.proc?.stdin
    if (!stdin || !stdin.writable || stdin.destroyed) {
      onFailure(
        new ChildError("write", `${this.options.name} is not accepting input`)
      )
      return
    }
    try {
      stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error)
          onFailure(
            new ChildError(
              "write",
              `Writing to ${this.options.name} failed: ${error.message}`
            )
          )
      })
    } catch (error) {
      onFailure(
        new ChildError(
          "write",
          `Writing to ${this.options.name} failed: ${error instanceof Error ? error.message : String(error)}`
        )
      )
    }
  }

  private handleLine(proc: ChildProcess, line: string): void {
    if (proc !== this.proc || line.trim() === "") return
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      if (this.options.debug)
        this.options.log(`[${this.options.name}] non-JSON stdout: ${line}`)
      return
    }
    if (
      typeof message !== "object" ||
      message === null ||
      Array.isArray(message)
    ) {
      if (this.options.debug)
        this.options.log(`[${this.options.name}] ignored stdout: ${line}`)
      return
    }
    const rpc = message as JsonRpcMessage
    if (rpc.method !== undefined) {
      if (rpc.id !== undefined) {
        /** No client-side sampling or elicitation exists to serve it. */
        this.write(
          {
            jsonrpc: "2.0",
            id: rpc.id,
            error: { code: -32601, message: "Method not found" }
          },
          () => undefined
        )
      } else if (this.options.debug)
        this.options.log(
          `[${this.options.name}] dropped notification ${rpc.method}`
        )
      return
    }
    const pending =
      typeof rpc.id === "number" ? this.pending.get(rpc.id) : undefined
    if (!pending || typeof rpc.id !== "number") {
      if (this.options.debug)
        this.options.log(`[${this.options.name}] unmatched response`)
      return
    }
    this.pending.delete(rpc.id)
    this.forget(pending.clientId, rpc.id)
    clearTimeout(pending.timer)
    pending.resolve(rpc)
  }

  private died(proc: ChildProcess, reason: string): void {
    if (proc !== this.proc) return
    this.proc = undefined
    this.sessionId = undefined
    this.initialize = undefined
    this.initializedForwarded = false
    this.options.log(`[${this.options.name}] ${reason}`)
    const waiting = [...this.pending.values()]
    this.pending.clear()
    this.inflight.clear()
    for (const entry of waiting) {
      clearTimeout(entry.timer)
      entry.reject(new ChildError("exit", `${this.options.name} ${reason}`))
    }
  }

  private kill(proc: ChildProcess): Promise<void> {
    const exited = this.exited
    const alreadyGone = proc.exitCode !== null || proc.signalCode !== null
    if (alreadyGone) return Promise.resolve()
    const tree =
      (this.options.platform ?? process.platform) === "win32" &&
      proc.pid !== undefined
    const signal = (name: "SIGTERM" | "SIGKILL") => {
      try {
        if (tree)
          (this.options.killTree ?? defaultKillTree)(
            proc.pid as number,
            name === "SIGKILL"
          )
        else proc.kill(name)
      } catch {
        /** Already gone. */
      }
    }
    signal("SIGTERM")
    return new Promise((resolve) => {
      const escalate = setTimeout(() => signal("SIGKILL"), KILL_GRACE_MS)
      /** Bounded even if SIGKILL somehow leaves no exit event. */
      const giveUp = setTimeout(() => resolve(), KILL_GRACE_MS * 2)
      void exited.then(() => {
        clearTimeout(escalate)
        clearTimeout(giveUp)
        resolve()
      })
    })
  }
}
