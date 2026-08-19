#!/usr/bin/env node
/**
 * CLI entry point.
 *
 * Reads `config.json` from the package root unless `--config` names another file,
 * layers the command line on top, and starts the server. Process-level concerns —
 * signals, crash logging — belong here rather than in the modules the tests import.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { backendNames } from "./backends/registry.js"
import type { ProxyOptions } from "./config.js"
import { startProxy } from "./proxy.js"

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))

const USAGE = `olc — serve an agent runtime over an OpenAI-compatible API

Usage: olc [options]

Core options:
  --port <number>          Port to listen on (default 8083)
  --host <address>         Address to bind (default 127.0.0.1)
  --api-key <key>          Require this bearer token on API routes
  --allowed-origins <list> Browser origins allowed to call the API
                           (default chrome-extension://*, moz-extension://*,
                           safari-web-extension://*; "*" allows any page)
  --backend <name>         Runtime adapter to serve (default opencode)
  --system-prompt <text>   Override the system prompt the client sends
  --no-bridge              Do not expose the client's tools to the runtime
  --config <path>          Read options from this JSON file
  --debug                  Verbose request and turn logging
  -h, --help               Show this help

OpenCode backend options:
  --opencode-url <url>     OpenCode server URL (default http://127.0.0.1:4097)
  --opencode <path>        Path to the OpenCode binary
  --agent <name>           OpenCode agent to prompt with
  --project-dir <path>     Directory OpenCode should treat as the project
  --allow-opencode-tools <ids>
                           Comma-separated OpenCode tools to leave enabled
  --plugin-dir <path>      Where to generate the bridge plugin
`

const FLAG_TO_OPTION: Record<string, string> = {
  "--port": "PORT",
  "--host": "BIND_HOST",
  "--api-key": "API_KEY",
  "--allowed-origins": "ALLOWED_ORIGINS",
  "--backend": "BACKEND",
  "--system-prompt": "SYSTEM_PROMPT",
  "--opencode-url": "OPENCODE_SERVER_URL",
  "--opencode": "OPENCODE_PATH",
  "--agent": "OPENCODE_AGENT",
  "--project-dir": "PROJECT_DIR",
  "--allow-opencode-tools": "ALLOW_OPENCODE_TOOLS",
  "--plugin-dir": "PLUGIN_DIR"
}

/** Parse argv into proxy options. Unknown flags are an error, not a silent no-op. */
export const parseArgs = (
  argv: string[]
): { options: ProxyOptions; help: boolean; configPath?: string } => {
  const options: ProxyOptions = {}
  let help = false
  let configPath: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string
    if (arg === "-h" || arg === "--help") {
      help = true
      continue
    }
    if (arg === "--debug") {
      options.DEBUG = true
      continue
    }
    if (arg === "--no-bridge") {
      options.BRIDGE_ENABLED = false
      continue
    }
    if (arg === "--config") {
      configPath = argv[index + 1]
      index += 1
      continue
    }
    const option = FLAG_TO_OPTION[arg]
    if (!option) throw new Error(`Unknown option: ${arg}`)
    const value = argv[index + 1]
    if (value === undefined) throw new Error(`${arg} needs a value`)
    options[option] = value
    index += 1
  }

  return { options, help, configPath }
}

const readConfigFile = (candidate: string): ProxyOptions => {
  if (!fs.existsSync(candidate)) return {}
  try {
    const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"))
    console.log(`[Config] Loaded from ${candidate}`)
    return parsed as ProxyOptions
  } catch (error) {
    console.error(
      `[Config] Error parsing ${candidate}:`,
      (error as Error).message
    )
    return {}
  }
}

const main = () => {
  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`[Fatal] ${(error as Error).message}\n`)
    console.log(USAGE)
    process.exit(1)
  }

  if (parsed.help) {
    console.log(`${USAGE}\nAvailable backends: ${backendNames().join(", ")}`)
    return
  }

  const defaultConfigPath = path.join(moduleDirectory, "..", "config.json")
  const fileOptions = readConfigFile(parsed.configPath ?? defaultConfigPath)

  process.on("unhandledRejection", (reason) => {
    console.error("[Proxy][Fatal] Unhandled promise rejection:", reason)
  })
  process.on("uncaughtException", (error) => {
    console.error("[Proxy][Fatal] Uncaught exception:", error)
  })

  let proxy: ReturnType<typeof startProxy>
  try {
    proxy = startProxy(parsed.options, fileOptions)
  } catch (error) {
    console.error("[Fatal] Failed to start:", (error as Error).message)
    process.exit(1)
  }
  const { config } = proxy

  console.log("[Config] Starting with configuration:")
  console.log(`  - Port: ${config.PORT}`)
  console.log(`  - Bind host: ${config.BIND_HOST}`)
  console.log(`  - Backend: ${config.BACKEND}`)
  console.log(
    `  - API key: ${config.API_KEY ? "configured" : "not configured (no auth)"}`
  )
  console.log(`  - Allowed origins: ${config.ALLOWED_ORIGINS.join(", ")}`)
  console.log(
    `  - Client tool bridge: ${config.BRIDGE_ENABLED ? "enabled" : "disabled"}`
  )
  console.log(
    `  - System prompt: ${config.SYSTEM_PROMPT ? "custom" : "from the client"}`
  )
  console.log(`  - Debug logging: ${config.DEBUG ? "enabled" : "disabled"}`)
  console.log(`  - Node PID: ${process.pid}`)

  const shutdown = (signal: string) => {
    console.log(`\n[Shutdown] Received ${signal}, shutting down gracefully...`)
    proxy
      .shutdown()
      .catch((error: unknown) =>
        console.error("[Shutdown] Cleanup failed:", (error as Error).message)
      )
      .finally(() => {
        console.log("[Shutdown] Server closed")
        process.exit(0)
      })
  }

  process.on("SIGINT", () => shutdown("SIGINT"))
  process.on("SIGTERM", () => shutdown("SIGTERM"))
}

/**
 * Run only when this file is the process entry point, so importing it for tests or
 * embedding does not start a server.
 */
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) main()
