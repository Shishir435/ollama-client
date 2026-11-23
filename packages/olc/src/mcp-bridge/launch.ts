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
  /** Directory the server is spawned in; relative commands resolve against it. */
  cwd?: string
  isFile: (file: string) => boolean
}

/**
 * The environment `spawn` will actually apply: the bridge's own process
 * environment overlaid with the server's `env`, and the server's `cwd`.
 * Resolution must see the same values or it finds a different executable.
 */
export const spawnEnvironment = (
  spec: { env?: Record<string, string>; cwd?: string } = {},
  platform: NodeJS.Platform = process.platform
): LaunchEnvironment => ({
  ...defaultEnvironment(),
  platform,
  env: mergeEnvironment(process.env, spec.env, platform),
  cwd: spec.cwd
})

/**
 * Overlay the server's variables on the bridge's. Windows names are
 * case-insensitive, and Node copies `process.env` with the system's own
 * casing (`Path`), so a server's `PATH` must replace that entry rather than
 * sit beside it: with both present, lookup and the child could each pick a
 * different one.
 */
export const mergeEnvironment = (
  base: Record<string, string | undefined>,
  overlay: Record<string, string> | undefined,
  platform: NodeJS.Platform
): Record<string, string | undefined> => {
  const merged = { ...base }
  if (!overlay) return merged
  for (const [name, value] of Object.entries(overlay)) {
    if (platform === "win32") {
      for (const key of Object.keys(merged)) {
        if (key.toLowerCase() === name.toLowerCase()) delete merged[key]
      }
    }
    merged[name] = value
  }
  return merged
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
  const relativeBase = environment.cwd
  const isPathLike = path.win32.basename(command) !== command
  /**
   * A relative PATH entry (`.\bin`) is relative to the directory the server is
   * spawned in, not to the bridge's own, so it is anchored the same way a
   * relative command is.
   */
  const directories = isPathLike
    ? [""]
    : (winEnv(environment.env, "PATH") ?? "")
        .split(";")
        .filter((directory) => directory !== "")
        .map((directory) =>
          relativeBase !== undefined && !path.win32.isAbsolute(directory)
            ? path.win32.resolve(relativeBase, directory)
            : directory
        )
  const anchored =
    isPathLike && relativeBase !== undefined && !path.win32.isAbsolute(command)
      ? path.win32.resolve(relativeBase, command)
      : command
  for (const directory of directories) {
    const base =
      directory === "" ? anchored : path.win32.join(directory, command)
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
