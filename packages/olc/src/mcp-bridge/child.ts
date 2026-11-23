/** One stdio MCP server process, lazily spawned and exposed as request/response calls. */
import { type ChildProcess, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import type { McpServerSpec } from "./config.js"
import { resolveLaunch } from "./launch.js"

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
  /** Client request id to bridge id for requests in flight on this process. */
  private readonly inflight = new Map<JsonRpcId, number>()
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
      const launch = resolveLaunch(spec.command, spec.args)
      proc = spawn(launch.command, launch.args, {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
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
      if (clientId !== undefined) this.inflight.set(clientId, id)
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
   */
  cancel(message: JsonRpcMessage): boolean {
    const params = message.params
    if (typeof params !== "object" || params === null) return false
    const requestId = (params as { requestId?: unknown }).requestId
    if (typeof requestId !== "string" && typeof requestId !== "number")
      return false
    const bridgeId = this.inflight.get(requestId)
    if (bridgeId === undefined) return false
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
    if (clientId !== undefined && this.inflight.get(clientId) === bridgeId)
      this.inflight.delete(clientId)
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
    try {
      proc.kill("SIGTERM")
    } catch {
      /** Already gone. */
    }
    return new Promise((resolve) => {
      const escalate = setTimeout(() => {
        try {
          proc.kill("SIGKILL")
        } catch {
          /** Already gone. */
        }
      }, KILL_GRACE_MS)
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
