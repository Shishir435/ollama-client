/** Lifecycle of a foreground child owned by this invocation, never an adopted PID. */
import { type ChildProcess, spawn } from "node:child_process"

export interface ForegroundSession {
  finished: Promise<number>
  stop: () => void
}

/** Forward terminal shutdown only to the child we created; keep logs off JSON stdout. */
export function startForegroundProcess(
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv
): ForegroundSession {
  const child = spawn(binary, args, {
    env,
    detached: false,
    stdio: ["ignore", 2, 2],
    windowsHide: true
  })
  return foregroundSession(child)
}

/** Register handlers before startup can finish, then remove every handler on exit. */
export function foregroundSession(child: ChildProcess): ForegroundSession {
  const interrupt = () => {
    child.kill("SIGINT")
  }
  const terminate = () => {
    child.kill("SIGTERM")
  }
  process.on("SIGINT", interrupt)
  process.on("SIGTERM", terminate)
  const cleanup = () => {
    process.off("SIGINT", interrupt)
    process.off("SIGTERM", terminate)
  }
  const finished = new Promise<number>((resolve) => {
    child.once("error", () => {
      cleanup()
      resolve(1)
    })
    child.once("exit", (code, signal) => {
      cleanup()
      resolve(
        code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1)
      )
    })
  })
  return { finished, stop: terminate }
}
