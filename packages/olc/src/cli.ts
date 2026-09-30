#!/usr/bin/env node
/**
 * CLI entry point.
 *
 * Reads `config.json` from the package root unless `--config` names another file,
 * layers the command line on top, and starts the server. Process-level concerns —
 * signals, crash logging — belong here rather than in the modules the tests import.
 */
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { resolveCodexConfig } from "./backends/codex/config.js"
import { checkCodexVersion } from "./backends/codex/version-check.js"
import {
  parseArgs,
  readConfigFile,
  selectBackend,
  USAGE
} from "./cli-options.js"
import { resolveConfig, resolveManagedPort } from "./config.js"
import {
  isProxyChild,
  readProxyLaunchRequest,
  startDetachedProxy
} from "./detached-proxy.js"
import { listManagedServers, runManagedService } from "./managed-services.js"
import {
  registerManagedProcess,
  unregisterManagedProcess
} from "./managed-processes.js"
import { resolveOllamaOptions } from "./ollama/config.js"
import { monitorOllama } from "./ollama/foreground.js"
import { runOllama } from "./ollama/runner.js"
import { resolveProcessMode } from "./process-mode.js"
import { serveProxy } from "./proxy-cli.js"
import { assertProxyPortAvailable } from "./proxy-preflight.js"
import { runUpdate } from "./update/runner.js"
import { OLC_VERSION } from "./version.js"

export { parseArgs } from "./cli-options.js"

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))

const main = async () => {
  if (isProxyChild()) {
    try {
      await serveProxy(await readProxyLaunchRequest(), true)
    } catch (error) {
      reportError(error, 1)
    }
    return
  }
  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs(process.argv.slice(2))
  } catch (error) {
    reportError(error, 2)
    return
  }

  if (parsed.help) {
    console.log(USAGE)
    return
  }

  if (parsed.options.VERSION === true) {
    console.log(OLC_VERSION)
    return
  }

  if (parsed.command === "update") {
    await runUpdateCli(parsed)
    return
  }

  if (parsed.command === "list") {
    if (await runManagedCommand(parsed, {})) return
  }

  const defaultConfigPath = path.join(moduleDirectory, "..", "config.json")
  let fileOptions: ReturnType<typeof readConfigFile>
  let backend: ReturnType<typeof selectBackend>
  let mode: ReturnType<typeof resolveProcessMode>
  let nativeOptions: ReturnType<typeof resolveOllamaOptions> | undefined
  try {
    fileOptions = readConfigFile(
      parsed.configPath ?? defaultConfigPath,
      !!parsed.configPath
    )
  } catch (error) {
    reportError(error, 2)
    return
  }

  if (await runManagedCommand(parsed, fileOptions)) return

  try {
    backend = selectBackend(parsed.options, fileOptions)
    mode = resolveProcessMode(parsed.options, fileOptions)
    if (backend === "ollama")
      nativeOptions = resolveOllamaOptions(parsed.options, fileOptions)
  } catch (error) {
    reportError(error, 2)
    return
  }
  if (nativeOptions) {
    await runNativeCli(nativeOptions)
    return
  }
  parsed.options.BACKEND = backend

  parsed.options.DEBUG = mode.debug
  try {
    const request = { options: parsed.options, fileOptions }
    const { BIND_HOST, PORT } = resolveConfig(parsed.options, fileOptions)
    await assertProxyPortAvailable({ backend, host: BIND_HOST, port: PORT })
    if (backend === "codex") {
      const warning = await checkCodexVersion({
        executable: resolveCodexConfig(request).CODEX_PATH
      })
      if (warning) console.warn(warning)
    }
    if (mode.detached) {
      const result = await startDetachedProxy(request, PORT)
      console.log(
        `Ready: ${result.url} (detached ${backend}, PID ${result.pid})`
      )
      console.log(`Logs: ${result.logPath}`)
      console.log(
        process.platform === "win32"
          ? `Stop this process through Task Manager (PID ${result.pid}); use --foreground for terminal control.`
          : `Stop: kill -TERM ${result.pid}`
      )
    } else await serveProxy(request)
  } catch (error) {
    reportError(error, 1)
  }
}

async function runManagedCommand(
  parsed: ReturnType<typeof parseArgs>,
  fileOptions: ReturnType<typeof readConfigFile>
): Promise<boolean> {
  if (parsed.command === "list") {
    try {
      await listManagedServers(parsed.options.JSON === true)
    } catch (error) {
      if (parsed.options.JSON === true) {
        const message =
          error instanceof Error ? error.message : "Unexpected failure"
        console.log(JSON.stringify({ servers: [], status: "error", message }))
        process.exitCode = 1
      } else reportError(error, 1)
    }
    return true
  }

  if (parsed.command === "laya" || parsed.command === "searxng") {
    if (!parsed.action) {
      reportError(new Error("A service action is required."), 2)
      return true
    }
    try {
      await runManagedService(
        parsed.command,
        parsed.action,
        parsed.action === "start"
          ? resolveManagedPort(parsed.options.PORT, fileOptions.PORT)
          : undefined,
        parsed.options.PURGE_DATA === true,
        path.resolve(moduleDirectory, "../services")
      )
    } catch (error) {
      reportError(error, 1)
    }
    return true
  }
  return false
}

/**
 * Run only when this file is the process entry point, so importing it for tests or
 * embedding does not start a server.
 */
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href

/** Keep machine-readable stdout usable even when argument validation fails. */
function reportError(error: unknown, code: number) {
  const message = error instanceof Error ? error.message : "Unexpected failure"
  if (process.argv.includes("--json"))
    console.log(
      JSON.stringify({
        backend: "ollama",
        ready: false,
        status: "error",
        message
      })
    )
  else console.error(`olc: ${message}`)
  process.exitCode = code
}

if (invokedDirectly) void main()

/**
 * Report an update the same way the native path reports a server: one line, or
 * one JSON object when asked. A version that does not exist is an error, so it
 * leaves through `reportError` with the available versions already in its text.
 */
async function runUpdateCli(
  parsed: ReturnType<typeof parseArgs>
): Promise<void> {
  const json = parsed.options.JSON === true
  try {
    const result = await runUpdate({
      requested: parsed.target ?? "latest",
      check: parsed.options.CHECK === true,
      json
    })
    console.log(json ? JSON.stringify(result) : result.message)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected failure"
    if (json)
      console.log(
        JSON.stringify({
          command: "update",
          current: OLC_VERSION,
          status: "error",
          message
        })
      )
    else console.error(`olc: ${message}`)
    process.exitCode = 1
  }
}

/** Keep foreground native sessions attached without changing read-only check behavior. */
async function runNativeCli(
  nativeOptions: ReturnType<typeof resolveOllamaOptions>
): Promise<void> {
  try {
    const runResult = await runOllama(nativeOptions)
    const { session, ...result } = runResult
    let processRecordId: string | undefined
    if (result.ready && runResult.pid) {
      try {
        processRecordId = await registerManagedProcess({
          service: "ollama",
          url: result.url,
          pid: runResult.pid
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unexpected failure"
        console.error(`[olc] Could not track the Ollama process: ${message}`)
      }
    }
    if (processRecordId && session) {
      const recordId = processRecordId
      void session.finished
        .then(() => unregisterManagedProcess(recordId))
        .catch((error: unknown) =>
          console.error(
            "[olc] Could not clear the Ollama process record:",
            error
          )
        )
    }
    console.log(
      nativeOptions.json
        ? JSON.stringify(result)
        : `${result.status}: ${result.url} (${result.message})`
    )
    process.exitCode = result.ready ? 0 : 1
    if (result.ready && !nativeOptions.check && !nativeOptions.detached) {
      process.exitCode = session
        ? await session.finished
        : await monitorOllama(
            result.url,
            nativeOptions.origins,
            nativeOptions.debug
          )
    }
  } catch (error) {
    reportError(error, 1)
  }
}
