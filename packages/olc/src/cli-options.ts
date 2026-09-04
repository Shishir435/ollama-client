/** CLI syntax and backend selection, independent of server lifecycle effects. */
import fs from "node:fs"
import type { ProxyOptions } from "./config.js"

export const USAGE = `olc — start native Ollama or an agent proxy

Usage: olc [options]

  olc                         Native Ollama, 127.0.0.1:11434
  olc --lan                   Native Ollama, 0.0.0.0:11434
  olc -b codex                Codex proxy, 127.0.0.1:8083
  olc -b opencode             OpenCode proxy, 127.0.0.1:8084
  olc update                  Install the latest release
  olc update 0.13.3           Install a specific release

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
  -V, --version               Print the installed version
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

Update options (olc update [version]):
  -k, --check                 Report what is available; install nothing
  -j, --json                  One JSON result on stdout (including errors)

olc installs from its GitHub releases, not from a registry, so olc update
downloads the same checksum-verified archive the installers use and replaces the
directory it is running from. The previous version is kept until the new one is
in place. A version that has no release is refused by name, with the versions
that do exist. Running from a repository checkout is refused too: update that
with git. olc update --check never touches the installation.

Proxy-only options (require -b codex or -b opencode):
  -K, --api-key <key>         Require a bearer token
  -s, --system-prompt <text>  Override the client's system prompt
  -n, --no-bridge             Disable the client tool bridge
  -P, --project-dir <path>    Agent project/workspace directory

OpenCode options (-b opencode):
  -u, --opencode-url <url>    Server URL (default http://127.0.0.1:4097)
  -x, --opencode <path>       OpenCode executable
  -a, --agent <name>          OpenCode agent
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
  "-h": "--help",
  "-V": "--version"
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
  "--json": ["JSON", true],
  "--version": ["VERSION", true]
}

/** Subcommands are the first token or nothing, so a flag can never be mistaken for one. */
export const COMMANDS = ["update"] as const
export type Command = "serve" | (typeof COMMANDS)[number]

/** Narrows a raw token to a command without asserting that it is one. */
function isCommand(value: string): value is (typeof COMMANDS)[number] {
  return COMMANDS.some((name) => name === value)
}

/** What `olc update` may be given; every other option belongs to a server. */
const UPDATE_FLAGS = new Set(["CHECK", "JSON", "VERSION"])

/**
 * Read a leading subcommand and its one positional argument.
 *
 * Only the first token is considered, so `--agent update` stays a flag value and
 * a backend named like a command stays a backend.
 */
function readCommand(argv: string[]): {
  command: Command
  target?: string
  start: number
} {
  const first = argv[0]
  if (first === undefined || !isCommand(first))
    return { command: "serve", start: 0 }
  const second = argv[1]
  /** The one positional olc has: the version `update` should install. */
  return second !== undefined && !second.startsWith("-")
    ? { command: first, target: second, start: 2 }
    : { command: first, start: 1 }
}

/** Reject missing values and repeated options instead of guessing user intent. */
export function parseArgs(argv: string[]) {
  const options: ProxyOptions = {}
  let help = false
  const { command, target, start } = readCommand(argv)
  for (let index = start; index < argv.length; index++) {
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
  /** Checked before CONFIG_PATH is removed, so --config cannot slip through. */
  if (command === "update") assertUpdateOptions(options)
  const configPath = options.CONFIG_PATH as string | undefined
  delete options.CONFIG_PATH
  return { options, help, configPath, command, target }
}

/** Name the option the way the user typed it, not the way it is stored. */
function flagFor(key: string): string {
  const boolean = Object.entries(BOOLEAN_FLAGS).find(
    ([, [name]]) => name === key
  )
  if (boolean) return boolean[0]
  return (
    Object.entries(VALUE_FLAGS).find(([, name]) => name === key)?.[0] ?? key
  )
}

/** Server options say nothing about an update, so accepting them would mislead. */
function assertUpdateOptions(options: ProxyOptions): void {
  const stray = Object.keys(options)
    .filter((key) => !UPDATE_FLAGS.has(key))
    .map(flagFor)[0]
  if (stray)
    throw new Error(
      `olc update takes a version and --check/--json; ${stray} configures a server. See olc --help.`
    )
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
  const native = [
    optionRule("LAN"),
    optionRule("LOCAL"),
    optionRule("OLLAMA_PATH", "OLC_OLLAMA_PATH"),
    optionRule("OLLAMA_HOST", "OLLAMA_HOST"),
    optionRule("OLLAMA_ORIGINS", "OLLAMA_ORIGINS"),
    optionRule("CHECK"),
    optionRule("JSON")
  ]
  const proxy = [
    optionRule("API_KEY", "OLC_API_KEY", "OPENCODE_PROXY_API_KEY"),
    optionRule("SYSTEM_PROMPT", "OLC_SYSTEM_PROMPT"),
    optionRule("BRIDGE_ENABLED", "OLC_BRIDGE_ENABLED"),
    optionRule("PROJECT_DIR")
  ]
  const codex = [
    optionRule("CODEX_PATH", "OLC_CODEX_PATH", "CODEX_PATH"),
    optionRule("CODEX_PROJECT_DIR", "OLC_CODEX_PROJECT_DIR"),
    optionRule("CODEX_WEB_SEARCH_MODE", "OLC_CODEX_WEB_SEARCH_MODE")
  ]
  const opencode = [
    optionRule("OPENCODE_SERVER_URL", "OPENCODE_SERVER_URL"),
    optionRule("OPENCODE_PATH", "OPENCODE_PATH"),
    optionRule("OPENCODE_AGENT", "OPENCODE_PROXY_AGENT"),
    optionRule("OPENCODE_PROXY_PROJECT_DIR", "OPENCODE_PROXY_PROJECT_DIR"),
    optionRule(
      "AUTO_APPROVE_PERMISSIONS",
      "OPENCODE_PROXY_AUTO_APPROVE_PERMISSIONS"
    ),
    optionRule("USE_ISOLATED_HOME", "OPENCODE_USE_ISOLATED_HOME"),
    optionRule(
      "EVENT_FIRST_DELTA_TIMEOUT_MS",
      "OPENCODE_PROXY_EVENT_FIRST_DELTA_TIMEOUT_MS"
    ),
    optionRule("EVENT_IDLE_TIMEOUT_MS", "OPENCODE_PROXY_EVENT_IDLE_TIMEOUT_MS"),
    optionRule("POLL_TIMEOUT_RETRIES", "OPENCODE_PROXY_POLL_TIMEOUT_RETRIES"),
    optionRule("ALLOW_OPENCODE_TOOLS", "OPENCODE_PROXY_ALLOW_OPENCODE_TOOLS"),
    optionRule("PLUGIN_DIR", "OPENCODE_PROXY_PLUGIN_DIR"),
    optionRule("PLUGIN_RUNTIME_DIR", "OPENCODE_PLUGIN_RUNTIME_DIR")
  ]
  const forbidden =
    backend === "ollama"
      ? [...proxy, ...codex, ...opencode]
      : [...native, ...(backend === "codex" ? opencode : codex)]
  const invalid = forbidden.find(
    ({ key, envKeys }) =>
      key in options ||
      key in file ||
      envKeys.some((envKey) => env[envKey] !== undefined)
  )
  if (invalid) {
    if (backend === "ollama" && invalid.key === "API_KEY")
      throw new Error(
        "Native Ollama cannot enforce API_KEY. Select -b codex/opencode or remove the proxy API key configuration."
      )
    throw new Error(
      `${invalid.key} is not supported by ${backend}; remove it from CLI, environment, or config, or select the matching backend with -b. See olc --help.`
    )
  }
  return backend as "ollama" | "codex" | "opencode"
}

interface BackendOptionRule {
  key: string
  envKeys: string[]
}

/** Name every layer that can configure a backend-owned option. */
function optionRule(key: string, ...envKeys: string[]): BackendOptionRule {
  return { key, envKeys }
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
