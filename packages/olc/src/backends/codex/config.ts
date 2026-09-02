/** Configuration owned by the Codex app-server backend. */
import os from "node:os"
import path from "node:path"
import { type ProxyOptions, stringOption } from "../../config.js"

export const CODEX_DEFAULTS = {
  CODEX_PATH: "codex",
  PROJECT_DIR: path.join(os.tmpdir(), "olc-codex-workspace"),
  WEB_SEARCH_MODE: "cached"
} as const

export type CodexWebSearchMode = "disabled" | "cached" | "indexed" | "live"

const CODEX_WEB_SEARCH_MODES: readonly CodexWebSearchMode[] = [
  "disabled",
  "cached",
  "indexed",
  "live"
]

export interface CodexConfig {
  CODEX_PATH: string
  PROJECT_DIR: string
  WEB_SEARCH_MODE: CodexWebSearchMode
}

export const resolveCodexConfig = ({
  options = {},
  fileOptions = {}
}: {
  options?: ProxyOptions
  fileOptions?: ProxyOptions
} = {}): CodexConfig => {
  const env = process.env
  const webSearchMode = stringOption(
    options.CODEX_WEB_SEARCH_MODE,
    env.OLC_CODEX_WEB_SEARCH_MODE,
    fileOptions.CODEX_WEB_SEARCH_MODE,
    CODEX_DEFAULTS.WEB_SEARCH_MODE
  )
  if (!CODEX_WEB_SEARCH_MODES.includes(webSearchMode as CodexWebSearchMode)) {
    throw new Error(
      `Invalid Codex web-search mode '${webSearchMode}'. Expected disabled, cached, indexed, or live.`
    )
  }

  return {
    CODEX_PATH: stringOption(
      options.CODEX_PATH,
      env.OLC_CODEX_PATH,
      env.CODEX_PATH,
      fileOptions.CODEX_PATH,
      CODEX_DEFAULTS.CODEX_PATH
    ),
    PROJECT_DIR: stringOption(
      options.CODEX_PROJECT_DIR,
      options.PROJECT_DIR,
      env.OLC_CODEX_PROJECT_DIR,
      fileOptions.CODEX_PROJECT_DIR,
      fileOptions.PROJECT_DIR,
      CODEX_DEFAULTS.PROJECT_DIR
    ),
    WEB_SEARCH_MODE: webSearchMode as CodexWebSearchMode
  }
}
