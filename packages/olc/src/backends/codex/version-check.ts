/**
 * Whether the `codex` olc starts is older than one this machine already runs.
 *
 * Codex lists models by client version, so an old CLI is shown fewer of
 * them — and the model cache a newer Codex (the ChatGPT app ships its own)
 * writes to `~/.codex/models_cache.json` fails to parse in the old one, which
 * then falls back to its built-in list. Nothing errors: the model menu just
 * silently lacks the newest models. The cache records the client version
 * that last refreshed it, which is the one comparison that says so.
 *
 * The cache alone is not enough: it records whichever Codex refreshed it
 * last, so an old CLI rewriting it hides the evidence. The Codex the ChatGPT
 * app bundles is read as a second reference where it is installed.
 *
 * olc only says so. Updating Codex is the user's decision, never olc's.
 */
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

type Version = readonly [number, number, number]

/** The first `major.minor.patch` in a version string; pre-release is ignored. */
export const parseCodexVersion = (text: unknown): Version | undefined => {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? ""))
  if (!match) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

const olderThan = (a: Version, b: Version): boolean => {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index]
  }
  return false
}

/** The warning to print, or undefined when either version is unknown. */
export const codexVersionWarning = ({
  running,
  references
}: {
  running?: string
  /** Versions this machine already runs, each with where it was seen. */
  references: readonly { version?: string; source: string }[]
}): string | undefined => {
  const runningVersion = parseCodexVersion(running)
  if (!runningVersion) return undefined
  let newest: { version: Version; source: string } | undefined
  for (const reference of references) {
    const version = parseCodexVersion(reference.version)
    if (version && (!newest || olderThan(newest.version, version)))
      newest = { version, source: reference.source }
  }
  if (!newest || !olderThan(runningVersion, newest.version)) return undefined
  return [
    `[olc] Warning: codex ${runningVersion.join(".")} is older than the ${newest.version.join(".")} ${newest.source}.`,
    "[olc] Models that need a newer Codex may be missing from the list.",
    "[olc] olc does not update Codex. To update it yourself: codex update, then restart olc."
  ].join("\n")
}

const runVersion = (executable: string): Promise<string | undefined> =>
  new Promise((resolve) => {
    execFile(
      executable,
      ["--version"],
      { timeout: 5_000, shell: process.platform === "win32" },
      (error, stdout) => resolve(error ? undefined : stdout)
    )
  })

/**
 * Best effort: a missing binary, an unreadable cache or an unrecognized
 * version all answer undefined, because startup reports those failures on
 * its own and this check must never be the reason a proxy did not start.
 */
/** Where the ChatGPT desktop app keeps the Codex it ships. */
export const BUNDLED_CODEX_PATHS: readonly string[] =
  process.platform === "darwin"
    ? ["/Applications/ChatGPT.app/Contents/Resources/codex"]
    : []

export const checkCodexVersion = async ({
  executable,
  codexHome = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"),
  bundled = BUNDLED_CODEX_PATHS,
  version = runVersion,
  read = (file: string) => readFile(file, "utf8")
}: {
  executable: string
  codexHome?: string
  bundled?: readonly string[]
  version?: (executable: string) => Promise<string | undefined>
  read?: (file: string) => Promise<string>
}): Promise<string | undefined> => {
  const cachePath = path.join(codexHome, "models_cache.json")
  const [running, bundledVersions, cached] = await Promise.all([
    version(executable).catch(() => undefined),
    Promise.all(
      bundled.map((file) =>
        version(file).then(
          (found) => ({
            version: found,
            source: `the ChatGPT app ships (${file})`
          }),
          () => ({ version: undefined, source: file })
        )
      )
    ),
    read(cachePath)
      .then(
        (text) =>
          (JSON.parse(text) as { client_version?: unknown }).client_version
      )
      .then((value) => (typeof value === "string" ? value : undefined))
      .catch(() => undefined)
  ])
  return codexVersionWarning({
    running,
    references: [
      ...bundledVersions,
      { version: cached, source: `that last refreshed ${cachePath}` }
    ]
  })
}
