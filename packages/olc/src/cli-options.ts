/** CLI syntax and backend selection, independent of server lifecycle effects. */
import fs from "node:fs"
import type { ProxyOptions } from "./config.js"

export const USAGE = `olc — start native Ollama or an agent proxy

Usage: olc [options]

  olc                         Native Ollama, 127.0.0.1:11434
  olc --lan                   Native Ollama, 0.0.0.0:11434
  olc -b codex                Codex proxy, 127.0.0.1:8083
  olc -b opencode             OpenCode proxy, 127.0.0.1:8084

Shared options:
  -b, --backend <name>        ollama (default), codex, or opencode
  -H, --host <address>        Bind address (default 127.0.0.1)
  -p, --port <number>         Ollama: 11434; Codex: 8083; OpenCode: 8084
  -o, --allowed-origins <list>
                               Comma-separated browser origins
  -c, --config <path>         JSON options; CLI > environment > file > defaults
  -D, --detached              Run in background (default)
  -f, --foreground            Stay attached to the terminal
  -d, --debug                 Verbose diagnostics; implies --foreground
  -h, --help                  Show help

Native Ollama options:
  -l, --lan                   Use LAN access for a standalone server
  -L, --local                 Restore loopback access explicitly
  -O, --ollama <path>         Ollama executable (default ollama)
  -k, --check                 Read-only readiness check; never start or restart
  -j, --json                  One JSON result on stdout (including errors)

All backends run in the background by default; --debug stays in the foreground.
For an existing Ollama app/service, foreground mode monitors it without taking
ownership; Ctrl-C leaves it running. New standalone foreground servers stop
with Ctrl-C. Ollama keeps its native API. OLLAMA_* values are passed only to a
standalone server olc starts; global, app, and service environments are never
changed. An incompatible macOS app is quit and replaced by a standalone server;
other managed services must be stopped or configured by their owner.
LAN access has no authentication: use only on a trusted network.

Proxy-only options (require -b codex or -b opencode):
  -K, --api-key <key>         Require a bearer token
  -s, --system-prompt <text>  Override the client's system prompt
  -n, --no-bridge             Disable the client tool bridge

OpenCode options (-b opencode):
  -u, --opencode-url <url>    Server URL (default http://127.0.0.1:4097)
  -x, --opencode <path>       OpenCode executable
  -a, --agent <name>          OpenCode agent
  -P, --project-dir <path>    Project directory
  -t, --allow-opencode-tools <ids>
                               Comma-separated tools to leave enabled
  -g, --plugin-dir <path>     Bridge plugin directory

Codex options (-b codex):
  -C, --codex <path>          Codex executable
  -W, --codex-project-dir <path>
                               Empty workspace for turns
  -w, --codex-web-search <mode>
                               disabled, cached, indexed, or live

Short flags take separate values and are case-sensitive. Long options accept
--name=value. Exit codes: 0 ready/help, 1 runtime failure
(or --check not ready), 2 invalid arguments/configuration.
`

export const SHORT_FLAG_ALIASES = {
  "-b": "--backend",
  "-H": "--host",
  "-p": "--port",
  "-o": "--allowed-origins",
  "-c": "--config",
  "-D": "--detached",
  "-f": "--foreground",
  "-d": "--debug",
  "-l": "--lan",
  "-L": "--local",
  "-O": "--ollama",
  "-k": "--check",
  "-j": "--json",
  "-K": "--api-key",
  "-s": "--system-prompt",
  "-n": "--no-bridge",
  "-u": "--opencode-url",
  "-x": "--opencode",
  "-a": "--agent",
  "-P": "--project-dir",
  "-t": "--allow-opencode-tools",
  "-g": "--plugin-dir",
  "-C": "--codex",
  "-W": "--codex-project-dir",
  "-w": "--codex-web-search",
  "-h": "--help"
} as const

const VALUE_FLAGS: Record<string, string> = {
  "--port": "PORT",
  "--host": "BIND_HOST",
  "--api-key": "API_KEY",
  "--allowed-origins": "ALLOWED_ORIGINS",
  "--backend": "BACKEND",
  "--ollama": "OLLAMA_PATH",
  "--system-prompt": "SYSTEM_PROMPT",
  "--opencode-url": "OPENCODE_SERVER_URL",
  "--opencode": "OPENCODE_PATH",
  "--agent": "OPENCODE_AGENT",
  "--project-dir": "PROJECT_DIR",
  "--allow-opencode-tools": "ALLOW_OPENCODE_TOOLS",
  "--plugin-dir": "PLUGIN_DIR",
  "--codex": "CODEX_PATH",
  "--codex-project-dir": "CODEX_PROJECT_DIR",
  "--codex-web-search": "CODEX_WEB_SEARCH_MODE",
  "--config": "CONFIG_PATH"
}
const BOOLEAN_FLAGS: Record<string, [string, boolean]> = {
  "--debug": ["DEBUG", true],
  "--detached": ["DETACHED", true],
  "--foreground": ["FOREGROUND", true],
  "--no-bridge": ["BRIDGE_ENABLED", false],
  "--lan": ["LAN", true],
  "--local": ["LOCAL", true],
  "--check": ["CHECK", true],
  "--json": ["JSON", true]
}

/** Reject missing values and repeated options instead of guessing user intent. */
export function parseArgs(argv: string[]) {
  const options: ProxyOptions = {}
  let help = false
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] as string
    const equals = token.startsWith("--") ? token.indexOf("=") : -1
    const flag = equals < 0 ? token : token.slice(0, equals)
    const canonical =
      SHORT_FLAG_ALIASES[flag as keyof typeof SHORT_FLAG_ALIASES] ?? flag
    if (canonical === "--help") {
      assertBooleanFlag(flag, equals)
      help = true
      continue
    }
    const boolean = BOOLEAN_FLAGS[canonical]
    const key = boolean?.[0] ?? VALUE_FLAGS[canonical]
    if (!key) throw new Error(`Unknown option: ${flag}. See olc --help.`)
    if (key in options) throw new Error(`${flag} was supplied more than once`)
    if (boolean) {
      assertBooleanFlag(flag, equals)
      options[key] = boolean[1]
      continue
    }
    const value = equals < 0 ? argv[++index] : token.slice(equals + 1)
    if (!value || /^-[a-z-]/i.test(value)) {
      throw new Error(`${flag} needs a value`)
    }
    options[key] = value
  }
  validatePort(options.PORT)
  const configPath = options.CONFIG_PATH as string | undefined
  delete options.CONFIG_PATH
  return { options, help, configPath }
}

/** An explicit missing or invalid config is an error; never silently fall back. */
export function readConfigFile(
  candidate: string,
  explicit = false
): ProxyOptions {
  if (!explicit && !fs.existsSync(candidate)) return {}
  try {
    const value: unknown = JSON.parse(fs.readFileSync(candidate, "utf8"))
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error()
    return value as ProxyOptions
  } catch {
    throw new Error(`Cannot read JSON object from config: ${candidate}`)
  }
}

/** Native Ollama is a CLI mode, not an AgentBackend routed through the proxy. */
export function selectBackend(
  options: ProxyOptions,
  file: ProxyOptions,
  env: NodeJS.ProcessEnv = process.env
) {
  const backend = options.BACKEND ?? env.OLC_BACKEND ?? file.BACKEND ?? "ollama"
  if (!["ollama", "codex", "opencode"].includes(String(backend))) {
    throw new Error(
      "Backend must be ollama, codex, or opencode. Use -b <name>."
    )
  }
  const native = ["LAN", "LOCAL", "OLLAMA_PATH", "CHECK", "JSON"]
  const proxy = ["API_KEY", "SYSTEM_PROMPT", "BRIDGE_ENABLED"]
  const codex = ["CODEX_PATH", "CODEX_PROJECT_DIR", "CODEX_WEB_SEARCH_MODE"]
  const opencode = [
    "OPENCODE_SERVER_URL",
    "OPENCODE_PATH",
    "OPENCODE_AGENT",
    "PROJECT_DIR",
    "ALLOW_OPENCODE_TOOLS",
    "PLUGIN_DIR"
  ]
  const forbidden =
    backend === "ollama"
      ? [...proxy, ...codex, ...opencode]
      : [...native, ...(backend === "codex" ? opencode : codex)]
  const invalid = forbidden.find((key) => key in options)
  if (invalid)
    throw new Error(
      `${invalid} is not supported by ${backend}; select the matching backend with -b. See olc --help.`
    )
  if (
    backend === "ollama" &&
    (env.OLC_API_KEY || env.OPENCODE_PROXY_API_KEY || file.API_KEY)
  ) {
    throw new Error(
      "Native Ollama cannot enforce API_KEY. Select -b codex/opencode or remove the proxy API key configuration."
    )
  }
  return backend as "ollama" | "codex" | "opencode"
}

/** Boolean switches cannot silently accept --flag=false as true. */
function assertBooleanFlag(flag: string, equals: number): void {
  if (equals >= 0) throw new Error(`${flag} does not take a value`)
}

/** Both CLI modes reject invalid explicit ports instead of silently falling back. */
function validatePort(value: unknown): void {
  if (value === undefined) return
  if (
    !/^\d+$/.test(String(value)) ||
    Number(value) < 1 ||
    Number(value) > 65535
  )
    throw new Error("--port must be an integer from 1 to 65535.")
}
