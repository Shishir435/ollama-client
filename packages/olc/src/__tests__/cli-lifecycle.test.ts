import { type ChildProcess, spawn } from "node:child_process"
import { once } from "node:events"
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync
} from "node:fs"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"

const directories: string[] = []
const launchers: ChildProcess[] = []
const ownedProxies = new Map<number, string>()

/** Only test-created proxies and fake runtimes are stopped during cleanup. */
afterEach(async () => {
  for (const child of launchers.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit")
      child.kill("SIGTERM")
      await exited
    }
  }
  for (const [pid, url] of ownedProxies) {
    try {
      process.kill(pid, "SIGTERM")
    } catch {
      /* Test child may already have exited. */
    }
    await expect
      .poll(async () => {
        try {
          await fetch(`${url}/health`, { signal: AbortSignal.timeout(200) })
          return false
        } catch {
          return true
        }
      })
      .toBe(true)
  }
  ownedProxies.clear()
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

/** Run the source CLI with its real child handoff but a fake Codex executable. */
function launch(args: string[], executable?: string) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "olc-cli-lifecycle-"))
  directories.push(directory)
  const fake = path.join(directory, "codex")
  copyFileSync(
    fileURLToPath(
      new URL(
        "../backends/codex/__tests__/fixtures/fake-codex.mjs",
        import.meta.url
      )
    ),
    fake
  )
  chmodSync(fake, 0o755)
  const child = spawn(
    process.execPath,
    [
      "--import",
      import.meta.resolve("tsx"),
      fileURLToPath(new URL("../cli.ts", import.meta.url)),
      "-b",
      "codex",
      "--codex",
      executable ?? fake,
      "--codex-project-dir",
      path.join(directory, "workspace"),
      "--api-key",
      "private-test-key",
      ...args
    ],
    {
      env: {
        ...process.env,
        OLC_LOG_DIR: path.join(directory, "logs"),
        OLC_DEBUG: "false",
        OLC_DETACHED: "true"
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  )
  launchers.push(child)
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (data) => {
    stdout += data
  })
  child.stderr.on("data", (data) => {
    stderr += data
  })
  return {
    child,
    stdout: () => stdout,
    stderr: () => stderr,
    exited: once(child, "exit")
  }
}

/** Reserve a temporary test port rather than ever binding the user's proxy port. */
async function unusedPort(): Promise<number> {
  const server = createServer()
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string")
    throw new Error("Missing test port")
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}

describe.skipIf(process.platform === "win32")(
  "CLI process lifecycle with fake runtime",
  () => {
    it("detaches by default, stays reachable after the launcher exits, and keeps credentials out of logs", async () => {
      const port = await unusedPort()
      const run = launch(["--port", String(port)])
      expect((await run.exited)[0], run.stderr()).toBe(0)
      const pid = Number(run.stdout().match(/PID (\d+)/)?.[1])
      expect(pid).toBeGreaterThan(0)
      const url = `http://127.0.0.1:${port}`
      ownedProxies.set(pid, url)
      expect(pid).not.toBe(run.child.pid)
      const response = await fetch(`${url}/v1/models`, {
        headers: { Authorization: "Bearer private-test-key" }
      })
      expect(response.status).toBe(200)
      expect(await response.text()).toContain("fake-codex")
      const log = run.stdout().match(/Logs: (.+)/)?.[1] as string
      expect(statSync(log).mode & 0o777).toBe(0o600)
      expect(readFileSync(log, "utf8")).not.toContain("private-test-key")
      expect(run.stdout()).toContain(`kill -TERM ${pid}`)
    }, 15000)

    it.each([
      "--debug",
      "--foreground"
    ])("%s stays attached and shuts down on SIGTERM", async (flag) => {
      const port = await unusedPort()
      const run = launch([flag, "--port", String(port)])
      await expect
        .poll(run.stdout, { timeout: 10000 })
        .toContain("foreground; Ctrl-C")
      expect(run.child.exitCode).toBeNull()
      await delay(50)
      expect(run.child.exitCode).toBeNull()
      expect(run.stdout()).not.toContain("(detached")
      run.child.kill("SIGTERM")
      expect((await run.exited)[0]).toBe(143)
      await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow()
    }, 15000)

    it("does not stop an existing proxy when a second launch collides with its port", async () => {
      const port = await unusedPort()
      const first = launch(["--port", String(port)])
      expect((await first.exited)[0]).toBe(0)
      const pid = Number(first.stdout().match(/PID (\d+)/)?.[1])
      const url = `http://127.0.0.1:${port}`
      ownedProxies.set(pid, url)
      const second = launch(["--port", String(port)])
      expect((await second.exited)[0]).toBe(1)
      expect(second.stdout()).not.toContain("Ready:")
      expect(second.stderr()).toContain(`Port ${port} is already in use.`)
      expect(second.stderr()).toContain(`olc codex proxy (PID ${pid})`)
      expect(second.stderr()).toContain("--port")
      expect((await fetch(`${url}/health`)).status).toBe(200)
    }, 15000)

    it("returns failure rather than claiming a missing runtime is ready", async () => {
      const port = await unusedPort()
      const run = launch(
        ["--port", String(port)],
        "/nonexistent/olc-test-codex"
      )
      expect((await run.exited)[0]).toBe(1)
      expect(run.stdout()).not.toContain("Ready:")
      expect(run.stderr()).toContain("Logs:")
      await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow()
    }, 15000)
  }
)
