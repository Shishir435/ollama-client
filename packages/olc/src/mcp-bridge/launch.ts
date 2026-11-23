/** Resolves how to spawn a configured command without ever enabling a shell. */
import fs from "node:fs"
import path from "node:path"

export interface LaunchTarget {
  command: string
  args: string[]
  /** Set when `args` is a ready-made command line that Node must not re-quote. */
  windowsVerbatimArguments?: boolean
}

export interface LaunchEnvironment {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  isFile: (file: string) => boolean
}

const defaultEnvironment = (): LaunchEnvironment => ({
  platform: process.platform,
  env: process.env,
  isFile: (file) => {
    try {
      return fs.statSync(file).isFile()
    } catch {
      return false
    }
  }
})

const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD"
const SHIM_EXTENSIONS = [".cmd", ".bat"]
/** Characters cmd.exe interprets even inside quotes once `/s` strips the outer pair. */
const CMD_METACHARACTERS = /([()\][%!^"`<>&|;, *?])/g

/** Env lookups on Windows are case-insensitive (`Path`, `PATH`, `PathExt`). */
const winEnv = (env: LaunchEnvironment["env"], name: string) => {
  const key = Object.keys(env).find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase()
  )
  return key === undefined ? undefined : env[key]
}

/** First existing file for `command` across PATH and PATHEXT, as Windows would find it. */
function resolveWindowsCommand(
  command: string,
  environment: LaunchEnvironment
): string | undefined {
  const extensions = (winEnv(environment.env, "PATHEXT") ?? DEFAULT_PATHEXT)
    .split(";")
    .filter((extension) => extension !== "")
  const hasExtension = extensions.some((extension) =>
    command.toLowerCase().endsWith(extension.toLowerCase())
  )
  const directories =
    path.win32.basename(command) !== command
      ? [""]
      : (winEnv(environment.env, "PATH") ?? "")
          .split(";")
          .filter((directory) => directory !== "")
  for (const directory of directories) {
    const base =
      directory === "" ? command : path.win32.join(directory, command)
    const candidates = hasExtension
      ? [base]
      : [...extensions.map((extension) => `${base}${extension}`), base]
    for (const candidate of candidates)
      if (environment.isFile(candidate)) return candidate
  }
  return undefined
}

/** Escapes one word for cmd.exe: argv-style quoting first, then metacharacter carets. */
function escapeCmdWord(value: string, doubleEscape: boolean): string {
  let word = value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")
  word = `"${word}"`
  word = word.replace(CMD_METACHARACTERS, "^$1")
  /** A `.cmd` shim re-parses its arguments, so the carets need a second layer. */
  return doubleEscape ? word.replace(CMD_METACHARACTERS, "^$1") : word
}

/**
 * Node cannot execute `.cmd`/`.bat` shims (npm's `npx`, `npm`) directly, and a
 * plain `shell: true` would splice unescaped arguments into a command line. On
 * Windows the command is resolved against PATH and PATHEXT and a shim is run
 * through `cmd.exe` with every word escaped so argument boundaries survive.
 * Elsewhere the command and arguments pass through untouched.
 */
export function resolveLaunch(
  command: string,
  args: string[],
  environment: LaunchEnvironment = defaultEnvironment()
): LaunchTarget {
  if (environment.platform !== "win32") return { command, args }
  const resolved = resolveWindowsCommand(command, environment) ?? command
  const extension = path.win32.extname(resolved).toLowerCase()
  if (!SHIM_EXTENSIONS.includes(extension)) return { command: resolved, args }
  if (args.some((arg) => /[\r\n\0]/.test(arg)))
    throw new Error("Arguments for a .cmd/.bat command cannot contain newlines")
  const commandLine = [
    escapeCmdWord(path.win32.normalize(resolved), false),
    ...args.map((arg) => escapeCmdWord(arg, true))
  ].join(" ")
  return {
    command: winEnv(environment.env, "ComSpec") ?? "cmd.exe",
    args: ["/d", "/s", "/c", `"${commandLine}"`],
    windowsVerbatimArguments: true
  }
}
