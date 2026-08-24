/** Configuration owned by the Codex app-server backend. */
import os from "node:os"
import path from "node:path"
import { type ProxyOptions, stringOption } from "../../config.js"

export const CODEX_DEFAULTS = {
  CODEX_PATH: "codex",
  PROJECT_DIR: path.join(os.tmpdir(), "olc-codex-workspace")
} as const

export interface CodexConfig {
  CODEX_PATH: string
  PROJECT_DIR: string
}

export const resolveCodexConfig = ({
  options = {},
  fileOptions = {}
}: {
  options?: ProxyOptions
  fileOptions?: ProxyOptions
} = {}): CodexConfig => {
  const env = process.env
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
    )
  }
}
