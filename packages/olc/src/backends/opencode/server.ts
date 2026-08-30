/**
 * Owns the OpenCode server the proxy talks to: finding its binary, starting one when
 * nothing is listening, and installing the bridge plugin it must load.
 *
 * Note: the plugin lives in a generated directory outside any user workspace and is
 * registered through `OPENCODE_CONFIG_CONTENT`. OpenCode resolves a `file://`
 * plugin's imports from that directory, so its plugin runtime is linked next to the
 * copied files; when the link cannot be made, OpenCode drops the plugin without an
 * error, which is why registration is verified per request.
 */
import { type ChildProcess, spawn } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import type { ProxyConfig, ProxyLogger } from "../../types.js"
import { sleep } from "../../util.js"
import type { OpencodeConfig } from "./config.js"
import type { ToolManifest } from "./tool-manifest.js"

const OPENCODE_BASENAME = "opencode"
const STARTUP_WAIT_ITERATIONS = 60
const STARTUP_WAIT_INTERVAL_MS = 2000
const STARTING_WAIT_ITERATIONS = 120
const STARTING_WAIT_INTERVAL_MS = 1000
const JAIL_PARENT = "opencode-proxy-jail"

const splitPathEnv = () =>
  (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)

const pushDir = (list: string[], dir?: string | null) => {
  if (!dir) return
  if (!list.includes(dir)) list.push(dir)
}

const pushExistingDir = (list: string[], dir?: string | null) => {
  if (!dir || !fs.existsSync(dir)) return
  if (!list.includes(dir)) list.push(dir)
}

const addVersionedDirs = (list: string[], baseDir: string, subpath: string) => {
  if (!baseDir || !fs.existsSync(baseDir)) return
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    pushExistingDir(list, path.join(baseDir, entry.name, subpath))
  }
}

const prefixToBin = (prefix?: string) => {
  if (!prefix) return null
  return process.platform === "win32" ? prefix : path.join(prefix, "bin")
}

const candidateNames = () =>
  process.platform === "win32"
    ? [
        `${OPENCODE_BASENAME}.cmd`,
        `${OPENCODE_BASENAME}.exe`,
        `${OPENCODE_BASENAME}.bat`,
        OPENCODE_BASENAME
      ]
    : [OPENCODE_BASENAME]

const findExecutableInDirs = (dirs: string[], names: string[]) => {
  for (const dir of dirs) {
    for (const name of names) {
      const full = path.join(dir, name)
      if (fs.existsSync(full)) return full
    }
  }
  return null
}

/** Locate the OpenCode binary across the shells and version managers people use. */
export const resolveOpencodePath = (
  requestedPath?: string
): { path: string | null; source: string } => {
  const input = (requestedPath ?? "").trim()
  const names = candidateNames()

  if (input) {
    const looksLikePath =
      path.isAbsolute(input) || input.includes("/") || input.includes("\\")
    if (looksLikePath) {
      if (fs.existsSync(input)) return { path: input, source: "config" }
      const resolved = path.resolve(process.cwd(), input)
      if (fs.existsSync(resolved)) return { path: resolved, source: "config" }
    }
  }

  const fromPath = findExecutableInDirs(splitPathEnv(), names)
  if (fromPath) return { path: fromPath, source: "PATH" }

  const extraDirs: string[] = []
  if (process.env.OPENCODE_HOME) {
    pushDir(extraDirs, path.join(process.env.OPENCODE_HOME, "bin"))
  }
  if (process.env.OPENCODE_DIR) {
    pushDir(extraDirs, path.join(process.env.OPENCODE_DIR, "bin"))
  }
  pushDir(
    extraDirs,
    prefixToBin(process.env.npm_config_prefix ?? process.env.NPM_CONFIG_PREFIX)
  )
  pushDir(extraDirs, process.env.PNPM_HOME)
  if (process.env.YARN_GLOBAL_FOLDER) {
    pushDir(extraDirs, path.join(process.env.YARN_GLOBAL_FOLDER, "bin"))
  }
  if (process.env.VOLTA_HOME) {
    pushDir(extraDirs, path.join(process.env.VOLTA_HOME, "bin"))
  }
  pushDir(extraDirs, process.env.NVM_BIN)
  pushDir(extraDirs, path.dirname(process.execPath))

  const home = os.homedir()
  if (home) {
    pushDir(extraDirs, path.join(home, ".opencode", "bin"))
    pushDir(extraDirs, path.join(home, ".local", "bin"))
    pushDir(extraDirs, path.join(home, ".npm-global", "bin"))
    pushDir(extraDirs, path.join(home, ".npm", "bin"))
    pushDir(extraDirs, path.join(home, ".pnpm-global", "bin"))
    pushDir(extraDirs, path.join(home, ".local", "share", "pnpm"))
    pushDir(extraDirs, path.join(home, ".asdf", "shims"))
  }

  if (process.platform === "win32") {
    pushDir(
      extraDirs,
      process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : null
    )
    pushDir(
      extraDirs,
      process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, "pnpm")
        : null
    )
    pushDir(extraDirs, process.env.NVM_HOME)
    pushDir(extraDirs, process.env.NVM_SYMLINK)
    pushDir(
      extraDirs,
      process.env.ProgramFiles
        ? path.join(process.env.ProgramFiles, "nodejs")
        : null
    )
    pushDir(
      extraDirs,
      process.env["ProgramFiles(x86)"]
        ? path.join(process.env["ProgramFiles(x86)"] as string, "nodejs")
        : null
    )
  } else {
    pushDir(extraDirs, "/usr/local/bin")
    pushDir(extraDirs, "/usr/bin")
    pushDir(extraDirs, "/bin")
    pushDir(extraDirs, "/opt/homebrew/bin")
    pushDir(extraDirs, "/snap/bin")
  }

  const nvmDir = process.env.NVM_DIR ?? (home ? path.join(home, ".nvm") : null)
  if (nvmDir) {
    addVersionedDirs(extraDirs, path.join(nvmDir, "versions", "node"), "bin")
  }
  const asdfDir =
    process.env.ASDF_DATA_DIR ?? (home ? path.join(home, ".asdf") : null)
  if (asdfDir) {
    addVersionedDirs(extraDirs, path.join(asdfDir, "installs", "nodejs"), "bin")
  }
  if (home) {
    addVersionedDirs(
      extraDirs,
      path.join(home, ".fnm", "node-versions", "v1"),
      path.join("installation", "bin")
    )
  }

  const fromExtras = findExecutableInDirs(extraDirs, names)
  if (fromExtras) return { path: fromExtras, source: "known-locations" }

  return { path: null, source: "not-found" }
}

/**
 * Find the `node_modules` directory OpenCode installs its plugin runtime into,
 * starting from the binary. `@opencode-ai/plugin` must resolve from there for a
 * generated plugin to load at all.
 */
export const resolvePluginRuntimeDirectory = (
  binaryPath?: string | null
): string | null => {
  const roots: string[] = []
  if (binaryPath) {
    let current = path.dirname(path.resolve(binaryPath))
    for (let depth = 0; depth < 5; depth += 1) {
      roots.push(current)
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
  }
  const home = os.homedir()
  if (home) roots.push(path.join(home, ".opencode"))

  for (const root of roots) {
    const candidate = path.join(root, "node_modules")
    if (fs.existsSync(path.join(candidate, "@opencode-ai", "plugin"))) {
      return candidate
    }
  }
  return null
}

export const checkHealth = (serverUrl: string): Promise<boolean> =>
  new Promise((resolve, reject) => {
    const request = http.get(`${serverUrl}/health`, (response) => {
      if (response.statusCode === 200) resolve(true)
      else reject(new Error(`Status ${response.statusCode}`))
    })
    request.on("error", reject)
    request.setTimeout(2000, () => {
      request.destroy()
      reject(new Error("Timeout"))
    })
  })

export const cleanupTempDirs = (): void => {
  if (process.platform === "win32") return
  const jailRoot = path.join(os.tmpdir(), JAIL_PARENT)
  try {
    if (fs.existsSync(jailRoot)) {
      fs.rmSync(jailRoot, { recursive: true, force: true })
    }
  } catch (error) {
    console.error(
      "[Cleanup] Failed to remove temp dirs:",
      (error as Error).message
    )
  }
}

export interface BackendSupervisor {
  ensureReady: () => Promise<void>
  readonly pluginLinked: boolean
  kill: () => void
}

/**
 * Supervises one OpenCode server.
 *
 * `ensureReady` is idempotent: it returns as soon as the configured server answers,
 * waits when another caller is already starting it, and only spawns a child process
 * when nothing is listening. A server the operator started themselves is used as-is,
 * including its own plugins.
 */
export const createBackendSupervisor = ({
  config,
  opencode,
  manifest,
  log
}: {
  config: ProxyConfig
  opencode: OpencodeConfig
  manifest: ToolManifest
  log: ProxyLogger
}): BackendSupervisor => {
  const state: {
    isStarting: boolean
    process: ChildProcess | null
    jailRoot: string | null
    pluginLinked: boolean
  } = {
    isStarting: false,
    process: null,
    jailRoot: null,
    pluginLinked: false
  }

  const buildConfigContent = (pluginEntry: string | null) => {
    let base: Record<string, unknown> = {}
    if (process.env.OPENCODE_CONFIG_CONTENT) {
      try {
        base = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT)
      } catch {
        log("Ignoring unparseable OPENCODE_CONFIG_CONTENT from the environment")
      }
    }
    const merged: Record<string, unknown> = { ...base }
    if (opencode.AUTO_APPROVE_PERMISSIONS && merged.permission === undefined) {
      merged.permission = "allow"
    }
    if (pluginEntry) {
      const existing = Array.isArray(merged.plugin)
        ? (merged.plugin as string[])
        : []
      merged.plugin = [...new Set([...existing, pluginEntry])]
    }
    return JSON.stringify(merged)
  }

  const installPlugin = (pluginRuntimeDirectory: string | null) => {
    if (!config.BRIDGE_ENABLED) return { installed: false, linked: false }
    try {
      const { linked } = manifest.install({
        sourceDirectory: opencode.PLUGIN_SOURCE_DIR,
        pluginRuntimeDirectory
      })
      state.pluginLinked = linked
      if (!linked) {
        console.warn(
          "[Proxy] Could not link OpenCode's plugin runtime, so client tools will not be callable. Install OpenCode so that @opencode-ai/plugin resolves, or set OPENCODE_PLUGIN_RUNTIME_DIR."
        )
      }
      return { installed: true, linked }
    } catch (error) {
      console.error(
        "[Proxy] Failed to install the bridge plugin:",
        (error as Error).message
      )
      return { installed: false, linked: false }
    }
  }

  const waitForHealth = async (iterations: number, intervalMs: number) => {
    for (let attempt = 0; attempt < iterations; attempt += 1) {
      await sleep(intervalMs)
      try {
        await checkHealth(opencode.OPENCODE_SERVER_URL)
        return true
      } catch (error) {
        if ((attempt + 1) % 5 === 0) {
          log(
            `Still waiting for the OpenCode backend (attempt ${attempt + 1}/${iterations}, last error: ${(error as Error).message})`
          )
        }
      }
    }
    return false
  }

  const ensureReady = async () => {
    if (state.isStarting) {
      console.log(
        `[Proxy] Backend already starting for ${opencode.OPENCODE_SERVER_URL}, waiting for it to become ready...`
      )
      const ready = await waitForHealth(
        STARTING_WAIT_ITERATIONS,
        STARTING_WAIT_INTERVAL_MS
      )
      if (!ready) throw new Error("Backend startup timeout")
      return
    }

    try {
      await checkHealth(opencode.OPENCODE_SERVER_URL)
      return
    } catch {
      // Nothing is listening yet; fall through and start one.
    }

    state.isStarting = true
    try {
      console.log(
        `[Proxy] OpenCode backend not found at ${opencode.OPENCODE_SERVER_URL}. Starting...`
      )

      if (state.process) {
        try {
          state.process.kill()
        } catch {
          // The child is already gone.
        }
      }
      if (state.jailRoot && fs.existsSync(state.jailRoot)) {
        try {
          fs.rmSync(state.jailRoot, { recursive: true, force: true })
        } catch {
          // A leftover jail is cleaned up on exit as well.
        }
      }

      const salt = Math.random().toString(36).slice(2, 9)
      const jailRoot = path.join(os.tmpdir(), JAIL_PARENT, salt)
      state.jailRoot = jailRoot
      const workspace = path.join(jailRoot, "empty-workspace")
      fs.mkdirSync(workspace, { recursive: true })

      const projectDir = opencode.PROJECT_DIR.trim()
        ? opencode.PROJECT_DIR.trim()
        : workspace
      if (projectDir !== workspace && !fs.existsSync(projectDir)) {
        console.warn(
          `[Proxy] PROJECT_DIR '${projectDir}' does not exist. Falling back to an empty workspace.`
        )
      }
      const cwd =
        projectDir !== workspace && fs.existsSync(projectDir)
          ? projectDir
          : workspace

      const resolved = resolveOpencodePath(opencode.OPENCODE_PATH)
      const opencodeBin =
        resolved.path ?? opencode.OPENCODE_PATH ?? OPENCODE_BASENAME
      if (resolved.path) {
        console.log(
          `[Proxy] Using OpenCode binary: ${opencodeBin} (source: ${resolved.source})`
        )
      } else {
        console.warn(
          `[Proxy] Unable to resolve the OpenCode binary for '${opencode.OPENCODE_PATH}'. Using it as-is.`
        )
      }

      const pluginRuntimeDirectory =
        opencode.PLUGIN_RUNTIME_DIR ||
        resolvePluginRuntimeDirectory(resolved.path)
      const plugin = installPlugin(pluginRuntimeDirectory)

      const envVars: NodeJS.ProcessEnv = {
        ...process.env,
        OPENCODE_PROJECT_DIR: cwd
      }
      if (process.platform !== "win32" && opencode.USE_ISOLATED_HOME) {
        const fakeHome = path.join(jailRoot, "fake-home")
        fs.mkdirSync(
          path.join(fakeHome, ".local", "share", "opencode", "storage"),
          { recursive: true }
        )
        envVars.HOME = fakeHome
        envVars.USERPROFILE = fakeHome
        console.log("[Proxy] Using an isolated home for OpenCode")
      }
      envVars.OPENCODE_CONFIG_CONTENT = buildConfigContent(
        plugin.installed ? manifest.pluginEntry : null
      )

      const [, , portPart] = opencode.OPENCODE_SERVER_URL.split(":")
      const port = portPart ? (portPart.split("/")[0] as string) : "4097"
      const useShell =
        process.platform === "win32" ||
        !resolved.path ||
        opencodeBin.endsWith(".cmd") ||
        opencodeBin.endsWith(".bat")

      const spawnArgs = ["serve", "--port", port, "--hostname", "127.0.0.1"]
      console.log(
        `[Proxy] Spawning OpenCode: ${opencodeBin} ${spawnArgs.join(" ")} (cwd: ${cwd}, shell: ${useShell})`
      )
      const child = spawn(opencodeBin, spawnArgs, {
        stdio: "inherit",
        cwd,
        env: envVars,
        shell: useShell
      })
      state.process = child
      console.log(
        `[Proxy] OpenCode child process started with pid ${child.pid}`
      )

      child.on("error", (error: NodeJS.ErrnoException) => {
        console.error(`[Proxy] Failed to spawn OpenCode: ${error.message}`)
        if (error.code === "ENOENT") {
          console.error(
            `[Proxy] Command '${opencode.OPENCODE_PATH}' not found. Install OpenCode or set 'OPENCODE_PATH' in config.json.`
          )
        }
      })
      child.on("exit", (code, signal) => {
        console.log(
          `[Proxy] OpenCode child process (pid ${child.pid}) exited with code ${code}, signal ${signal}`
        )
      })

      const started = await waitForHealth(
        STARTUP_WAIT_ITERATIONS,
        STARTUP_WAIT_INTERVAL_MS
      )
      if (!started) {
        console.warn("[Proxy] Backend start timed out.")
        throw new Error("Backend start timeout")
      }
      console.log("[Proxy] OpenCode backend ready.")
    } finally {
      state.isStarting = false
    }
  }

  return {
    ensureReady,
    get pluginLinked() {
      return state.pluginLinked
    },
    kill: () => {
      if (state.process) {
        try {
          state.process.kill()
        } catch {
          // The child may already have exited.
        }
      }
      for (const directory of [state.jailRoot, opencode.PLUGIN_DIR]) {
        if (!directory) continue
        try {
          fs.rmSync(directory, { recursive: true, force: true })
        } catch {
          // Best effort; both live under the system temp directory.
        }
      }
    }
  }
}
