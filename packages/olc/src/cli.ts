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
import {
  parseArgs,
  readConfigFile,
  selectBackend,
  USAGE
} from "./cli-options.js"
import { resolveConfig } from "./config.js"
import {
  isProxyChild,
  readProxyLaunchRequest,
  startDetachedProxy
} from "./detached-proxy.js"
import { resolveOllamaOptions } from "./ollama/config.js"
import { monitorOllama } from "./ollama/foreground.js"
import { runOllama } from "./ollama/runner.js"
import { resolveProcessMode } from "./process-mode.js"
import { serveProxy } from "./proxy-cli.js"

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
    if (mode.detached) {
      const result = await startDetachedProxy(
        request,
        resolveConfig(parsed.options, fileOptions).PORT
      )
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

/** Keep foreground native sessions attached without changing read-only check behavior. */
async function runNativeCli(
  nativeOptions: ReturnType<typeof resolveOllamaOptions>
): Promise<void> {
  try {
    const { session, ...result } = await runOllama(nativeOptions)
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
