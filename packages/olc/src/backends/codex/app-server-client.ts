/** Minimal JSONL JSON-RPC client for `codex app-server --stdio`. */
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import readline from "node:readline"
import type { ProxyLogger } from "../../types.js"
import { isRecord } from "../../util.js"

export interface AppServerMessage {
  id?: string | number
  method?: string
  params?: unknown
  result?: unknown
  error?: { code?: unknown; message?: unknown }
}

type NotificationListener = (message: AppServerMessage) => void
type ServerRequestHandler = (
  message: AppServerMessage
) => Promise<unknown | undefined>

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export class CodexAppServerClient {
  private readonly executable: string
  private readonly cwd: string
  private readonly log: ProxyLogger
  private readonly requestTimeoutMs: number
  private process: ChildProcessWithoutNullStreams | null = null
  private startPromise: Promise<void> | null = null
  private nextId = 1
  private readonly pending = new Map<string, PendingRequest>()
  private readonly listeners = new Set<NotificationListener>()
  private readonly intentionalStops =
    new WeakSet<ChildProcessWithoutNullStreams>()
  private serverRequestHandler: ServerRequestHandler | null = null

  constructor({
    executable,
    cwd,
    log,
    requestTimeoutMs = 30_000
  }: {
    executable: string
    cwd: string
    log: ProxyLogger
    requestTimeoutMs?: number
  }) {
    this.executable = executable
    this.cwd = cwd
    this.log = log
    this.requestTimeoutMs = requestTimeoutMs
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise
    this.startPromise = this.startInner().catch((error) => {
      this.startPromise = null
      throw error
    })
    return this.startPromise
  }

  private async startInner(): Promise<void> {
    const child = spawn(this.executable, ["app-server", "--stdio"], {
      cwd: this.cwd,
      // npm exposes command-line packages as `.cmd` shims on Windows. Node cannot
      // execute those directly, so let cmd.exe resolve the operator-selected binary.
      shell: process.platform === "win32",
      stdio: ["pipe", "pipe", "pipe"]
    })
    this.process = child

    const stdout = readline.createInterface({ input: child.stdout })
    stdout.on("line", (line) => this.handleLine(line))
    const stderr = readline.createInterface({ input: child.stderr })
    stderr.on("line", (line) => this.log("Codex app-server stderr", { line }))

    child.once("error", (error) => {
      if (this.process === child) this.failAll(error)
    })
    child.once("exit", (code, signal) => {
      const error = new Error(
        `Codex app-server exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}`
      )
      // A failed attempt may finish exiting after a retry has already spawned.
      // Never let that stale child clear or fail the new child's state.
      if (this.process !== child) return
      this.process = null
      this.startPromise = null
      this.failAll(error)
      if (!this.intentionalStops.has(child)) {
        this.emit({
          method: "olc/appServerExited",
          params: { message: error.message }
        })
      }
    })

    try {
      await this.request("initialize", {
        clientInfo: {
          name: "ollama_client_olc",
          title: "Ollama Client OLC",
          version: "1.0.0"
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false
        }
      })
      this.notify("initialized", {})
    } catch (error) {
      await this.terminateChild(
        child,
        error instanceof Error
          ? error
          : new Error("Codex app-server initialization failed")
      )
      throw error
    }
  }

  onNotification(listener: NotificationListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setServerRequestHandler(handler: ServerRequestHandler): void {
    this.serverRequestHandler = handler
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++
    const key = String(id)
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key)
        reject(
          new Error(
            `Codex app-server request '${method}' timed out after ${this.requestTimeoutMs}ms`
          )
        )
      }, this.requestTimeoutMs)
      if (typeof timer.unref === "function") timer.unref()
      this.pending.set(key, { resolve, reject, timer })
    })
    try {
      this.write({ method, id, params })
    } catch (error) {
      const pending = this.pending.get(key)
      if (pending) clearTimeout(pending.timer)
      this.pending.delete(key)
      throw error
    }
    return (await promise) as T
  }

  notify(method: string, params: unknown): void {
    this.write({ method, params })
  }

  async shutdown(): Promise<void> {
    const child = this.process
    if (!child) return
    await this.terminateChild(
      child,
      new Error("Codex app-server is shutting down")
    )
  }

  private async terminateChild(
    child: ChildProcessWithoutNullStreams,
    reason: Error
  ): Promise<void> {
    this.intentionalStops.add(child)
    if (this.process === child) {
      this.process = null
      this.startPromise = null
      this.failAll(reason)
    }
    if (!child.stdin.destroyed) child.stdin.destroy()
    if (child.exitCode !== null || child.signalCode !== null) return

    const exitedAfterTerm = this.waitForExit(child, 1_000)
    try {
      child.kill("SIGTERM")
    } catch {
      return
    }
    if (await exitedAfterTerm) return

    const exitedAfterKill = this.waitForExit(child, 1_000)
    try {
      child.kill("SIGKILL")
    } catch {
      return
    }
    await exitedAfterKill
  }

  private waitForExit(
    child: ChildProcessWithoutNullStreams,
    timeoutMs: number
  ): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false
      const finish = (exited: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.off("exit", onExit)
        child.off("close", onExit)
        resolve(exited)
      }
      const onExit = () => finish(true)
      const timer = setTimeout(() => finish(false), timeoutMs)
      if (typeof timer.unref === "function") timer.unref()
      child.once("exit", onExit)
      child.once("close", onExit)
      if (child.exitCode !== null || child.signalCode !== null) finish(true)
    })
  }

  private write(message: AppServerMessage): void {
    const child = this.process
    if (!child || child.stdin.destroyed) {
      throw new Error(
        `Codex app-server is not running. Install Codex CLI and run 'codex login' first.`
      )
    }
    child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private handleLine(line: string): void {
    let message: AppServerMessage
    try {
      const parsed = JSON.parse(line)
      if (!isRecord(parsed)) return
      message = parsed as AppServerMessage
    } catch {
      this.log("Ignored non-JSON output from Codex app-server", { line })
      return
    }

    if (message.id !== undefined && message.method) {
      void this.handleServerRequest(message)
      return
    }

    if (message.id !== undefined) {
      const pending = this.pending.get(String(message.id))
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(String(message.id))
      if (message.error) {
        pending.reject(
          new Error(
            typeof message.error.message === "string"
              ? message.error.message
              : "Codex app-server request failed"
          )
        )
      } else {
        pending.resolve(message.result)
      }
      return
    }

    if (message.method) this.emit(message)
  }

  private async handleServerRequest(message: AppServerMessage): Promise<void> {
    try {
      const result = await this.serverRequestHandler?.(message)
      if (result === undefined) {
        this.write({
          id: message.id,
          error: {
            code: -32601,
            message: `OLC does not handle app-server request '${message.method}'`
          }
        })
        return
      }
      this.write({ id: message.id, result })
    } catch (error) {
      this.write({
        id: message.id,
        error: { code: -32000, message: (error as Error).message }
      })
    }
  }

  private emit(message: AppServerMessage): void {
    for (const listener of this.listeners) listener(message)
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
