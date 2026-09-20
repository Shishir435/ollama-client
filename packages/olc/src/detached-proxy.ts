/** Detached proxy launch with a private IPC readiness/ownership handoff. */
import { type ChildProcess, spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { ProxyOptions } from "./config.js"
import { isRecord } from "./util.js"

export interface ProxyLaunchRequest {
  options: ProxyOptions
  fileOptions: ProxyOptions
}
export interface DetachedProxyResult {
  pid: number
  url: string
  logPath: string
}

/** Only the private IPC child path skips detaching; no public hidden argv flag. */
export function isProxyChild(): boolean {
  return (
    process.env.OLC_PROXY_CHILD === "1" && typeof process.send === "function"
  )
}

/** Config travels over IPC rather than duplicating credentials in child argv or files. */
export function readProxyLaunchRequest(): Promise<ProxyLaunchRequest> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error("Proxy launcher did not send configuration."))
    }, 5000)
    const receive = (message: unknown) => {
      if (!isRecord(message) || message.type !== "olc:start") return
      cleanup()
      if (
        !isRecord(message.options) ||
        !isRecord(message.fileOptions) ||
        !["codex", "opencode"].includes(String(message.options.BACKEND))
      ) {
        reject(new Error("Invalid proxy launch configuration."))
      } else
        resolve({ options: message.options, fileOptions: message.fileOptions })
    }
    const disconnected = () => {
      cleanup()
      reject(new Error("Proxy launcher disconnected before startup."))
    }
    const cleanup = () => {
      clearTimeout(timeout)
      process.off("message", receive)
      process.off("disconnect", disconnected)
    }
    process.on("message", receive)
    process.on("disconnect", disconnected)
    if (!process.connected) disconnected()
    else
      process.send?.({ type: "olc:boot" }, (error: Error | null) => {
        if (error) disconnected()
      })
  })
}

/** Wait for bind/backend readiness and explicit detachment, never just a spawned PID. */
export function awaitProxyHandoff(
  child: ChildProcess,
  request: ProxyLaunchRequest,
  logPath: string,
  timeoutMs = 60000
): Promise<DetachedProxyResult> {
  return new Promise((resolve, reject) => {
    let requested = false
    let readyUrl: string | undefined
    let settled = false
    const cleanup = () => {
      clearTimeout(timeout)
      child.off("message", receive)
      child.off("exit", exited)
      child.off("disconnect", disconnected)
      process.off("SIGINT", cancelled)
      process.off("SIGTERM", cancelled)
    }
    const fail = (message: string) => {
      if (settled) return
      settled = true
      cleanup()
      child.kill("SIGTERM")
      if (child.connected) child.disconnect()
      reject(new Error(`${message} Logs: ${logPath}`))
    }
    const receive = (message: unknown) => {
      if (!isRecord(message)) return
      if (message.type === "olc:boot" && !requested) {
        requested = true
        child.send({ type: "olc:start", ...request }, (error) => {
          if (error) fail("Could not send proxy configuration.")
        })
      }
      if (message.type === "olc:error") return fail(startupFailure(message))
      if (
        message.type === "olc:ready" &&
        typeof message.url === "string" &&
        !readyUrl
      ) {
        readyUrl = message.url
        child.send({ type: "olc:detach" }, (error) => {
          if (error) fail("Could not hand off the proxy.")
        })
      }
      if (message.type === "olc:detached" && readyUrl && child.pid) {
        settled = true
        cleanup()
        child.unref()
        resolve({ pid: child.pid, url: readyUrl, logPath })
      }
    }
    const exited = () => fail("Proxy exited before startup completed.")
    const disconnected = () =>
      fail("Proxy disconnected before startup completed.")
    const cancelled = () => fail("Proxy startup cancelled.")
    const timeout = setTimeout(
      () => fail("Proxy startup timed out after waiting for the backend."),
      timeoutMs
    )
    child.on("message", receive)
    child.once("exit", exited)
    child.once("disconnect", disconnected)
    child.on("error", () => fail("Could not launch the proxy."))
    process.on("SIGINT", cancelled)
    process.on("SIGTERM", cancelled)
  })
}

/**
 * Carry the child's own reason into the launcher's failure, bounded and on one
 * line: a log path tells the user where to look, not what went wrong.
 */
function startupFailure(message: Record<string, unknown>): string {
  const reason = typeof message.message === "string" ? message.message : ""
  const detail = reason.replace(/\s+/g, " ").trim().slice(0, 200)
  if (!detail) return "Proxy startup failed."
  return `Proxy startup failed: ${/[.!?]$/.test(detail) ? detail : `${detail}.`}`
}

/** Launch this CLI in a new process session with private per-run log output. */
export async function startDetachedProxy(
  request: ProxyLaunchRequest,
  port: number
): Promise<DetachedProxyResult> {
  const directory =
    process.env.OLC_LOG_DIR || path.join(os.homedir(), ".olc", "logs")
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const logPath = path.join(
    directory,
    `${request.options.BACKEND}-${port}-${Date.now()}-${randomBytes(4).toString("hex")}.log`
  )
  const log = await fs.open(logPath, "wx", 0o600)
  try {
    const child = spawn(
      process.execPath,
      [...process.execArgv, path.resolve(process.argv[1] as string)],
      {
        env: { ...process.env, OLC_PROXY_CHILD: "1" },
        cwd: process.cwd(),
        detached: true,
        stdio: ["ignore", log.fd, log.fd, "ipc"],
        windowsHide: true
      }
    )
    return await awaitProxyHandoff(child, request, logPath)
  } finally {
    await log.close()
  }
}
