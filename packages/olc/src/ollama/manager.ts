/** Native process ownership: use an existing app/service, otherwise launch Ollama. */
import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  type ForegroundSession,
  startForegroundProcess
} from "../foreground-process.js"
import { bindAddress, type OllamaOptions } from "./config.js"
import {
  command,
  type Listener,
  ollamaEnvironment,
  processIdentity,
  stopListener,
  waitForExit
} from "./process.js"

export interface ManagerRun {
  detail: string
  session?: ForegroundSession
}

export interface Manager {
  kind: "mac-app" | "system-service" | "user-service" | "cli"
  appPath?: string
}

/** Prefer the manager already supervising Ollama, never compete with its respawn. */
export async function detectManager(listener?: Listener): Promise<Manager> {
  if (process.platform === "darwin") return detectMacManager(listener)
  if (process.platform === "linux") return detectSystemdManager(listener)
  return { kind: "cli" }
}

/** Match the server's actual parent before choosing the macOS app. */
async function detectMacManager(listener?: Listener): Promise<Manager> {
  if (listener) {
    const parent = await command("ps", [
      "-p",
      String(listener.pid),
      "-o",
      "ppid="
    ])
    const owner = await command("ps", ["-p", parent, "-o", "comm="])
    const suffix = "/Contents/MacOS/Ollama"
    if (owner.endsWith(suffix))
      return { kind: "mac-app", appPath: owner.slice(0, -suffix.length) }
    const jobs = await command("launchctl", ["list"])
    if (
      jobs
        .split("\n")
        .some((line) => Number(line.trim().split(/\s+/)[0]) === listener.pid)
    ) {
      throw new Error(
        "Ollama is supervised by launchd (for example Homebrew services). Configure and restart that service through its manager; olc will not kill a supervised child process."
      )
    }
    return { kind: "cli" }
  }
  for (const appPath of [
    "/Applications/Ollama.app",
    path.join(os.homedir(), "Applications/Ollama.app")
  ]) {
    try {
      await fs.access(appPath)
      return { kind: "mac-app", appPath }
    } catch {
      /* Try the other standard installation location. */
    }
  }
  return { kind: "cli" }
}

/** Only the unit owning the current server may restart it. */
async function detectSystemdManager(listener?: Listener): Promise<Manager> {
  for (const scope of ["system", "user"] as const) {
    try {
      const loaded = await command("systemctl", [
        ...(scope === "user" ? ["--user"] : []),
        "show",
        "ollama.service",
        "--property=LoadState",
        "--value"
      ])
      if (loaded !== "loaded") continue
      if (listener) {
        const pid = await command("systemctl", [
          ...(scope === "user" ? ["--user"] : []),
          "show",
          "ollama.service",
          "--property=MainPID",
          "--value"
        ])
        if (Number(pid) !== listener.pid) continue
      }
      return { kind: scope === "user" ? "user-service" : "system-service" }
    } catch {
      /* Non-systemd installations fall through to the CLI. */
    }
  }
  if (listener) {
    const groups = await fs.readFile(`/proc/${listener.pid}/cgroup`, "utf8")
    const units = groups
      .split(/[/\n]/)
      .filter((part) => part.endsWith(".service"))
    if (units.some((unit) => !/^user@\d+\.service$/.test(unit)))
      throw new Error(
        "Ollama belongs to another service. Restart it through that service manager; olc will not kill a supervised process."
      )
  }
  return { kind: "cli" }
}

/** Manager-owned settings survive restarting through that manager. */
export async function managerEnvironment(
  manager: Manager,
  listener?: Listener
): Promise<NodeJS.ProcessEnv> {
  if (manager.kind === "mac-app") {
    const entries = await Promise.all(
      ["OLLAMA_HOST", "OLLAMA_ORIGINS"].map(async (key) => {
        try {
          return [key, await command("launchctl", ["getenv", key])]
        } catch {
          return [key, ""]
        }
      })
    )
    return {
      ...Object.fromEntries(entries),
      ...(listener ? await ollamaEnvironment(listener) : {})
    }
  }
  if (listener) {
    try {
      return await ollamaEnvironment(listener)
    } catch (error) {
      if (manager.kind === "system-service")
        throw new Error(
          "Ollama is a system service and its settings are not readable. Configure OLLAMA_HOST and OLLAMA_ORIGINS with sudo systemctl edit ollama.service, then restart that service. No process was stopped."
        )
      throw error
    }
  }
  if (manager.kind === "system-service" || manager.kind === "user-service") {
    const start =
      manager.kind === "user-service"
        ? "systemctl --user start ollama.service"
        : "sudo systemctl start ollama.service"
    throw new Error(
      `No Ollama listener was found on the requested port. Start the existing service with ${start}, then rerun olc on its current port so its effective settings can be preserved. No service configuration was changed.`
    )
  }
  return {}
}

/** A detached child must report successful spawn before its launcher exits. */
async function startDetached(
  binary: string,
  env: NodeJS.ProcessEnv
): Promise<string> {
  const directory = path.join(os.homedir(), ".ollama")
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const logPath = path.join(directory, "olc.log")
  const log = await fs.open(logPath, "a", 0o600)
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(binary, ["serve"], {
        env,
        detached: true,
        stdio: ["ignore", log.fd, log.fd],
        windowsHide: true
      })
      child.once("error", () =>
        reject(
          new Error(
            "Could not launch Ollama. Install Ollama or pass --ollama <path>."
          )
        )
      )
      child.once("spawn", () => {
        child.unref()
        resolve()
      })
    })
  } finally {
    await log.close()
  }
  return logPath
}

/** Service files escape systemd quoting/specifiers; never interpolate shell commands. */
function serviceValue(value: string): string {
  if (/[\r\n\0]/.test(value))
    throw new Error(
      "Ollama settings cannot contain newlines or NUL characters."
    )
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("%", "%%")
}

/** Restart via systemd with a dedicated drop-in, leaving the vendor unit untouched. */
async function restartService(
  manager: Manager,
  host: string,
  origins: string
): Promise<void> {
  const user = manager.kind === "user-service"
  if (!user && process.getuid?.() !== 0) {
    throw new Error(
      `Ollama is managed by systemd. Run sudo systemctl edit ollama.service and add:\n[Service]\nEnvironment="OLLAMA_HOST=${serviceValue(host)}"\nEnvironment="OLLAMA_ORIGINS=${serviceValue(origins)}"\nThen run sudo systemctl daemon-reload && sudo systemctl restart ollama.service, and olc --check. No service configuration was changed.`
    )
  }
  const root = user
    ? path.join(os.homedir(), ".config/systemd/user")
    : "/etc/systemd/system"
  const directory = path.join(root, "ollama.service.d")
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(
    path.join(directory, "99-olc.conf"),
    `[Service]\nEnvironment="OLLAMA_HOST=${serviceValue(host)}"\nEnvironment="OLLAMA_ORIGINS=${serviceValue(origins)}"\n`,
    { mode: 0o600 }
  )
  const prefix = user ? ["--user"] : []
  await command("systemctl", [...prefix, "daemon-reload"])
  await command("systemctl", [...prefix, "restart", "ollama.service"])
}

/** Validate launch prerequisites before touching the running server. */
export async function prepareManager(
  manager: Manager,
  options: OllamaOptions
): Promise<void> {
  if (manager.kind !== "cli") {
    if (options.binary !== "ollama")
      throw new Error(
        "--ollama cannot replace an app/service-managed installation. Stop that manager first."
      )
    return
  }
  if (process.platform === "win32") {
    const tray = await command("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "@(Get-Process -Name 'ollama app' -ErrorAction SilentlyContinue).Count"
    ])
    if (Number(tray) > 0)
      throw new Error(
        "Quit Ollama from the Windows tray before running olc to change its settings; olc will not force-kill the tray app."
      )
  }
  try {
    await command(options.binary, ["--version"])
  } catch {
    throw new Error(
      "Ollama is not available. Install it from https://ollama.com/download or pass --ollama <path>."
    )
  }
}

/** Restart only through the discovered owner; settings not changed here stay intact. */
export async function applyManager(
  manager: Manager,
  options: OllamaOptions,
  env: NodeJS.ProcessEnv,
  listener?: Listener
): Promise<ManagerRun> {
  const host = bindAddress(options.host, options.port)
  const origins = options.origins.join(",")
  if (manager.kind === "mac-app") {
    if (
      listener &&
      (await processIdentity(listener.pid)).identity !== listener.identity
    )
      throw new Error("Ollama changed while preparing its restart; retry olc.")
    for (const [key, value] of Object.entries(env)) {
      if (
        key.startsWith("OLLAMA_") &&
        value !== undefined &&
        key !== "OLLAMA_HOST" &&
        key !== "OLLAMA_ORIGINS"
      )
        await command("launchctl", ["setenv", key, value])
    }
    await command("launchctl", ["setenv", "OLLAMA_HOST", host])
    await command("launchctl", ["setenv", "OLLAMA_ORIGINS", origins])
    await command("osascript", [
      "-e",
      'if application "Ollama" is running then tell application "Ollama" to quit'
    ])
    if (listener) await waitForExit(listener)
    await command("open", ["-a", manager.appPath as string])
    return { detail: "Ollama app (settings last until logout)" }
  }
  if (manager.kind !== "cli") {
    await restartService(manager, host, origins)
    return { detail: "ollama.service" }
  }
  if (listener) await stopListener(listener)
  const childEnv = {
    ...process.env,
    ...env,
    OLLAMA_HOST: host,
    OLLAMA_ORIGINS: origins,
    ...(options.debug ? { OLLAMA_DEBUG: "1" } : {})
  }
  if (!options.detached)
    return {
      detail: "foreground Ollama; Ctrl-C stops this server",
      session: startForegroundProcess(options.binary, ["serve"], childEnv)
    }
  const log = await startDetached(options.binary, childEnv)
  return { detail: `log: ${log}` }
}
