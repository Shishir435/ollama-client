/** Bounded OS queries and identity-checked graceful termination for native Ollama. */
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { promisify } from "node:util"

const execute = promisify(execFile)

/** Commands never run through a shell or print potentially private environment data. */
export async function command(file: string, args: string[]): Promise<string> {
  const result = await execute(file, args, {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true
  })
  return result.stdout.trim()
}

export interface Listener {
  pid: number
  identity: string
  host: string
  executable: string
  uid: number
}

/** Capture executable, owner, and birth time so a recycled PID is never signalled. */
export async function processIdentity(
  pid: number
): Promise<Omit<Listener, "host">> {
  const identity = await command("ps", [
    "-p",
    String(pid),
    "-o",
    "uid=,lstart=,comm="
  ])
  const match = identity.match(
    /^\s*(\d+)\s+\S+\s+\S+\s+\d+\s+[\d:]+\s+\d+\s+(.+)$/
  )
  if (!match)
    throw new Error(
      "Could not verify the listener's process identity; leaving it running."
    )
  return {
    pid,
    identity,
    uid: Number(match[1]),
    executable: match[2] as string
  }
}

/** lsof supplies both process and actual bind address; HTTP alone cannot prove LAN. */
export async function listeners(port: number): Promise<Listener[]> {
  if (process.platform === "win32") return windowsListeners(port)
  let output: string
  try {
    output = await command("lsof", [
      "-nP",
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
      "-Fpn"
    ])
  } catch (error) {
    const failure = error as {
      code?: unknown
      stdout?: string
      stderr?: string
    }
    if (failure.code === 1 && !failure.stdout && !failure.stderr) return []
    throw new Error(
      "Cannot inspect the listening process. Install lsof and ensure process inspection is permitted; nothing was restarted."
    )
  }
  const found = new Map<number, string>()
  let pid = 0
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1))
    if (pid && line.startsWith("n")) {
      const host = line.slice(1, line.lastIndexOf(":")).replace(/^\[|\]$/g, "")
      found.set(pid, host === "*" ? "0.0.0.0" : host)
    }
  }
  return Promise.all(
    [...found].map(async ([id, host]) => ({
      ...(await processIdentity(id)),
      host
    }))
  )
}

/** An unknown listener must never be displaced, even if its HTTP response resembles Ollama. */
export function assertOllamaListeners(found: Listener[]): void {
  if (
    found.some(
      (item) =>
        !["ollama", "ollama.exe"].includes(path.win32.basename(item.executable))
    )
  ) {
    throw new Error(
      "The port is occupied by a process other than Ollama; choose --port or stop that process yourself."
    )
  }
  if (found.length > 1)
    throw new Error(
      "Multiple Ollama processes occupy this port; stop the extra server before retrying."
    )
}

/** Preserve Ollama settings without copying or logging unrelated process secrets. */
export async function ollamaEnvironment(
  listener: Listener
): Promise<NodeJS.ProcessEnv> {
  if (process.platform === "linux") {
    const raw = await fs.readFile(`/proc/${listener.pid}/environ`, "utf8")
    return Object.fromEntries(
      raw
        .split("\0")
        .filter((entry) => entry.startsWith("OLLAMA_"))
        .map((entry) => {
          const equals = entry.indexOf("=")
          return [entry.slice(0, equals), entry.slice(equals + 1)]
        })
    )
  }
  if (process.platform === "darwin") {
    const raw = await command("ps", [
      "eww",
      "-p",
      String(listener.pid),
      "-o",
      "command="
    ])
    const matches = [...raw.matchAll(/(?:^|\s)([A-Za-z_][A-Za-z_0-9]*)=/g)]
    return Object.fromEntries(
      matches.flatMap((match, index) => {
        const key = match[1] as string
        const value = raw
          .slice(
            (match.index ?? 0) + match[0].length,
            matches[index + 1]?.index
          )
          .trimEnd()
        return key.startsWith("OLLAMA_") ? [[key, value]] : []
      })
    )
  }
  throw new Error(
    "Quit Ollama from the Windows tray (or stop ollama serve), then rerun olc with its OLLAMA_* settings exported. Windows process environments cannot be safely recovered for an automatic restart."
  )
}

const EXIT_POLL_MS = 250

/** A CLI process handles SIGTERM promptly; anything longer is a hang, not a slow stop. */
export const EXIT_TIMEOUT_MS = 10_000

/**
 * The macOS app tears down its UI and its own serve child before the port frees,
 * so it is given a far longer deadline than a CLI SIGTERM. Waiting costs nothing
 * while it lasts — Ollama is still serving — whereas giving up early can abandon
 * an app that was already asked to quit and never start its replacement.
 */
export const APP_EXIT_TIMEOUT_MS = 60_000

/** True once the PID is gone or has been recycled into a different process. */
async function hasExited(listener: Listener): Promise<boolean> {
  try {
    const current = await processIdentity(listener.pid)
    return current.identity !== listener.identity
  } catch {
    try {
      process.kill(listener.pid, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return true
    }
    return false
  }
}

/** Wait for a specific process to exit without escalating to SIGKILL. */
export async function waitForExit(
  listener: Listener,
  timeoutMs: number = EXIT_TIMEOUT_MS
): Promise<void> {
  const attempts = Math.ceil(timeoutMs / EXIT_POLL_MS)
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await hasExited(listener)) return
    await delay(EXIT_POLL_MS)
  }
  /** Poll once more: exiting during the last interval is an exit, not a timeout. */
  if (await hasExited(listener)) return
  throw new Error(
    `Ollama did not stop within ${Math.round(timeoutMs / 1000)} seconds and is still listening on ${listener.host}. No force-kill was attempted and no replacement was started, so the running server was left as it is; stop it manually and retry.`
  )
}

/** Signal only a still-identical Ollama owned by the caller, then wait for exit. */
export async function stopListener(listener: Listener): Promise<void> {
  const current = await processIdentity(listener.pid)
  if (
    current.identity !== listener.identity ||
    current.uid !== process.getuid?.() ||
    path.basename(current.executable) !== "ollama"
  ) {
    throw new Error(
      "Ollama's process identity or owner changed; leaving it running."
    )
  }
  process.kill(listener.pid, "SIGTERM")
  await waitForExit(listener)
}

/** Windows inspection is read-only and uses validated numeric ports, not user scripts. */
async function windowsListeners(port: number): Promise<Listener[]> {
  const output = await command("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `$ErrorActionPreference='Stop'; $connections = @(Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq ${port}); $items = @($connections | ForEach-Object { $p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $_.OwningProcess); if (!$p -or !$p.ExecutablePath) { throw 'Cannot identify listener' }; [PSCustomObject]@{pid=[int]$p.ProcessId; identity=($p.CreationDate.ToString('o') + $p.ExecutablePath); host=$_.LocalAddress; executable=$p.ExecutablePath; uid=-1} }); ConvertTo-Json -InputObject $items -Compress`
  ])
  const items = JSON.parse(output) as Listener[]
  return [
    ...new Map(
      items.map((item) => [
        item.pid,
        { ...item, host: item.host === "::" ? "0.0.0.0" : item.host }
      ])
    ).values()
  ]
}
