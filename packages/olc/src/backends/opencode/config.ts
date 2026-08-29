/**
 * Configuration owned by the OpenCode backend.
 *
 * Note: this is deliberately separate from `ProxyConfig`. A backend resolves its own
 * settings from the same options, environment and config file, so adding a backend
 * never means widening the core's configuration type. Legacy
 * `OPENCODE_PROXY_*` names are still accepted alongside the `OLC_*` ones.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  boolOption,
  listOption,
  numberOption,
  type ProxyOptions,
  stringOption
} from "../../config.js"

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))

/**
 * Where the plugin sources sit relative to this module.
 *
 * Two layouts ship: compiled per-file (`dist/backends/opencode/config.js`, plugin
 * beside it) and bundled into one file (`dist/olc.mjs`, plugin under `dist/`). The
 * directory is probed rather than assumed, so the bundled CLI finds the same plugin
 * the compiled one does.
 */
const resolvePluginSourceDirectory = (): string => {
  const candidates = [
    path.join(moduleDirectory, "plugin"),
    path.join(moduleDirectory, "backends", "opencode", "plugin")
  ]
  return (
    candidates.find((candidate) =>
      fs.existsSync(path.join(candidate, "bridge.ts"))
    ) ?? (candidates[0] as string)
  )
}

export const OPENCODE_DEFAULTS = {
  OPENCODE_SERVER_URL: "http://127.0.0.1:4097",
  OPENCODE_PATH: "opencode",
  EVENT_FIRST_DELTA_TIMEOUT_MS: 6000,
  EVENT_IDLE_TIMEOUT_MS: 12_000,
  POLL_TIMEOUT_RETRIES: 2
} as const

export interface OpencodeConfig {
  OPENCODE_SERVER_URL: string
  OPENCODE_PATH: string
  OPENCODE_AGENT: string
  PROJECT_DIR: string
  AUTO_APPROVE_PERMISSIONS: boolean
  USE_ISOLATED_HOME: boolean
  EVENT_FIRST_DELTA_TIMEOUT_MS: number
  EVENT_IDLE_TIMEOUT_MS: number
  POLL_TIMEOUT_RETRIES: number
  ALLOW_OPENCODE_TOOLS: string[]
  PLUGIN_SOURCE_DIR: string
  PLUGIN_DIR: string
  PLUGIN_RUNTIME_DIR: string
}

export const resolveOpencodeConfig = ({
  options = {},
  fileOptions = {},
  port
}: {
  options?: ProxyOptions
  fileOptions?: ProxyOptions
  port: number
}): OpencodeConfig => {
  const env = process.env

  return {
    OPENCODE_SERVER_URL: stringOption(
      options.OPENCODE_SERVER_URL,
      env.OPENCODE_SERVER_URL,
      fileOptions.OPENCODE_SERVER_URL,
      OPENCODE_DEFAULTS.OPENCODE_SERVER_URL
    ),
    OPENCODE_PATH: stringOption(
      options.OPENCODE_PATH,
      env.OPENCODE_PATH,
      fileOptions.OPENCODE_PATH,
      OPENCODE_DEFAULTS.OPENCODE_PATH
    ),
    OPENCODE_AGENT: stringOption(
      options.OPENCODE_AGENT,
      env.OPENCODE_PROXY_AGENT,
      fileOptions.OPENCODE_AGENT
    ),
    PROJECT_DIR: stringOption(
      options.PROJECT_DIR,
      env.OPENCODE_PROXY_PROJECT_DIR,
      fileOptions.PROJECT_DIR
    ),
    AUTO_APPROVE_PERMISSIONS: boolOption(
      [
        options.AUTO_APPROVE_PERMISSIONS,
        env.OPENCODE_PROXY_AUTO_APPROVE_PERMISSIONS,
        fileOptions.AUTO_APPROVE_PERMISSIONS
      ],
      true
    ),
    USE_ISOLATED_HOME: boolOption(
      [
        options.USE_ISOLATED_HOME,
        env.OPENCODE_USE_ISOLATED_HOME,
        fileOptions.USE_ISOLATED_HOME
      ],
      false
    ),
    EVENT_FIRST_DELTA_TIMEOUT_MS: numberOption(
      options.EVENT_FIRST_DELTA_TIMEOUT_MS,
      env.OPENCODE_PROXY_EVENT_FIRST_DELTA_TIMEOUT_MS,
      fileOptions.EVENT_FIRST_DELTA_TIMEOUT_MS,
      OPENCODE_DEFAULTS.EVENT_FIRST_DELTA_TIMEOUT_MS
    ),
    EVENT_IDLE_TIMEOUT_MS: numberOption(
      options.EVENT_IDLE_TIMEOUT_MS,
      env.OPENCODE_PROXY_EVENT_IDLE_TIMEOUT_MS,
      fileOptions.EVENT_IDLE_TIMEOUT_MS,
      OPENCODE_DEFAULTS.EVENT_IDLE_TIMEOUT_MS
    ),
    POLL_TIMEOUT_RETRIES: numberOption(
      options.POLL_TIMEOUT_RETRIES,
      env.OPENCODE_PROXY_POLL_TIMEOUT_RETRIES,
      fileOptions.POLL_TIMEOUT_RETRIES,
      OPENCODE_DEFAULTS.POLL_TIMEOUT_RETRIES
    ),
    ALLOW_OPENCODE_TOOLS: listOption([
      options.ALLOW_OPENCODE_TOOLS,
      env.OPENCODE_PROXY_ALLOW_OPENCODE_TOOLS,
      fileOptions.ALLOW_OPENCODE_TOOLS
    ]),
    PLUGIN_SOURCE_DIR: resolvePluginSourceDirectory(),
    PLUGIN_DIR: stringOption(
      options.PLUGIN_DIR,
      env.OPENCODE_PROXY_PLUGIN_DIR,
      fileOptions.PLUGIN_DIR,
      path.join(os.tmpdir(), "olc-bridge", `port-${port}`)
    ),
    PLUGIN_RUNTIME_DIR: stringOption(
      options.PLUGIN_RUNTIME_DIR,
      env.OPENCODE_PLUGIN_RUNTIME_DIR,
      fileOptions.PLUGIN_RUNTIME_DIR
    )
  }
}
