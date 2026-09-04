/**
 * Replacing an installed olc with a newer release archive.
 *
 * This is the same sequence `olc.sh` performs — download, verify the published
 * SHA-256, unpack, swap the directory, keep a backup until the swap succeeds —
 * done in the process that is being replaced. Two consequences shape it:
 *
 * - Nothing is downloaded and executed from a URL the user typed. The archive
 *   comes from the release the API named, and it is only unpacked after its
 *   checksum matches the checksum published beside it.
 * - A failed swap must leave the working installation in place. The old
 *   directory is moved aside rather than deleted, and put back if anything after
 *   that fails, so a broken download costs the user nothing.
 */
import { execFile } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { createWriteStream } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { promisify } from "node:util"
import type { Release } from "./github.js"

const execute = promisify(execFile)

const DOWNLOAD_TIMEOUT_MS = 120_000
const EXTRACT_TIMEOUT_MS = 120_000
/** Generous next to a ~2MB archive, and still a bound rather than none. */
const ARCHIVE_LIMIT_BYTES = 64 * 1024 * 1024

/** Windows takes the zip because `Expand-Archive` is what it always has. */
export const archiveName = (): string =>
  process.platform === "win32" ? "olc.zip" : "olc.tar.gz"

export interface InstallTarget {
  /** The directory holding `bin/` and `dist/`, which is what gets replaced. */
  root: string
}

/**
 * Locate the installation to replace, or explain why there isn't one.
 *
 * A release install is `<root>/dist/olc.mjs` beside `<root>/bin/olc` and no
 * `package.json`: that last absence is what separates it from a checkout, where
 * replacing the directory would destroy someone's working tree.
 */
export async function resolveInstallTarget(
  entry: string | undefined
): Promise<InstallTarget> {
  if (!entry || path.basename(entry) !== "olc.mjs")
    throw new Error(
      "This olc is running from source, not from an installed release. Update it with `git pull`, or install a release from https://ollamaclient.in."
    )
  const root = path.dirname(path.dirname(path.resolve(entry)))
  if (await exists(path.join(root, "package.json")))
    throw new Error(
      `This olc runs out of the repository at ${root}, so there is nothing to replace. Update it with \`git pull\` and \`pnpm proxy:bundle\`.`
    )
  if (!(await exists(path.join(root, "bin"))))
    throw new Error(
      `${root} does not look like an olc installation, so it was left alone. Reinstall from https://ollamaclient.in.`
    )
  return { root }
}

export interface InstallDependencies {
  download: (url: string, destination: string) => Promise<void>
  fetchText: (url: string) => Promise<string>
  extract: (archive: string, destination: string) => Promise<void>
}

const dependencies: InstallDependencies = {
  download: downloadFile,
  fetchText,
  extract: extractArchive
}

/**
 * Install `release` over `target`, returning only once the new files are live.
 *
 * The staging directory is a sibling of the installation so the final move is a
 * rename within one filesystem, which is what makes the swap quick enough to be
 * hard to interrupt halfway.
 */
export async function installRelease(
  target: InstallTarget,
  release: Release,
  deps: InstallDependencies = dependencies
): Promise<void> {
  const name = archiveName()
  const archive = release.assets.find((asset) => asset.name === name)
  const checksum = release.assets.find(
    (asset) => asset.name === `${name}.sha256`
  )
  if (!archive || !checksum)
    throw new Error(
      `Release ${release.version} has no ${name} to install. Pick another version, or install from https://github.com/Shishir435/ollama-client/releases.`
    )

  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "olc-update-"))
  const parent = path.dirname(target.root)
  const suffix = randomBytes(6).toString("hex")
  const staged = path.join(parent, `.olc-update-${suffix}`)
  const backup = path.join(parent, `.olc-backup-${suffix}`)
  try {
    const archivePath = path.join(workspace, name)
    await deps.download(archive.downloadUrl, archivePath)
    const expected = (await deps.fetchText(checksum.downloadUrl))
      .trim()
      .split(/\s+/)[0]
      ?.toLowerCase()
    const actual = await sha256(archivePath)
    if (!expected || actual !== expected)
      throw new Error(
        "The downloaded archive does not match its published checksum, so nothing was installed."
      )
    await deps.extract(archivePath, workspace)
    const payload = path.join(workspace, "olc")
    if (!(await exists(path.join(payload, "dist", "olc.mjs"))))
      throw new Error(
        "The release archive is missing dist/olc.mjs, so nothing was installed."
      )
    await fs.rename(payload, staged)
    await swap({ root: target.root, staged, backup })
    await fs.rm(backup, { recursive: true, force: true })
    await makeExecutable(target.root)
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
    await fs.rm(staged, { recursive: true, force: true })
  }
}

/** The old installation is only removed once its replacement is in place. */
async function swap({
  root,
  staged,
  backup
}: {
  root: string
  staged: string
  backup: string
}): Promise<void> {
  const hadPrevious = await exists(root)
  if (hadPrevious) await fs.rename(root, backup)
  try {
    await fs.rename(staged, root)
  } catch (error) {
    if (hadPrevious) await fs.rename(backup, root)
    throw new Error(
      process.platform === "win32"
        ? `Windows would not replace ${root} while olc is running from it. Close other olc processes and try again, or reinstall with: irm https://ollamaclient.in/olc.ps1 | iex`
        : `Could not install into ${root}: ${error instanceof Error ? error.message : "unknown failure"}. The previous version was put back.`
    )
  }
}

/** An archive unpacked by `tar`/`Expand-Archive` may not carry the exec bit. */
async function makeExecutable(root: string): Promise<void> {
  if (process.platform === "win32") return
  for (const relative of ["bin/olc", "dist/olc.mjs"]) {
    try {
      await fs.chmod(path.join(root, relative), 0o755)
    } catch {
      /* A release that ships a different layout is not a failed install. */
    }
  }
}

/** Stream to disk under a size cap; a release archive is megabytes, not gigabytes. */
async function downloadFile(url: string, destination: string): Promise<void> {
  const response = await fetch(url, {
    headers: { "User-Agent": "olc" },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
  })
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw new Error(`Download failed with HTTP ${response.status}.`)
  }
  let seen = 0
  const capped = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength
      if (seen > ARCHIVE_LIMIT_BYTES)
        throw new Error("The download is larger than any olc release.")
      controller.enqueue(chunk)
    }
  })
  await pipeline(
    Readable.fromWeb(response.body.pipeThrough(capped)),
    createWriteStream(destination)
  )
}

/** The checksum file is one short line, so it is read whole. */
async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": "olc" },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(
      `Could not read the published checksum (HTTP ${response.status}).`
    )
  }
  return (await response.text()).slice(0, 1024)
}

/** Both unpackers ship with their platform, so neither is a new prerequisite. */
async function extractArchive(
  archive: string,
  destination: string
): Promise<void> {
  if (process.platform === "win32") {
    await execute(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Expand-Archive -LiteralPath $env:OLC_ARCHIVE -DestinationPath $env:OLC_DESTINATION -Force"
      ],
      {
        timeout: EXTRACT_TIMEOUT_MS,
        windowsHide: true,
        env: {
          ...process.env,
          OLC_ARCHIVE: archive,
          OLC_DESTINATION: destination
        }
      }
    )
    return
  }
  await execute("tar", ["-xzf", archive, "-C", destination], {
    timeout: EXTRACT_TIMEOUT_MS,
    windowsHide: true
  })
}

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256")
  await pipeline(Readable.from(await fs.readFile(file)), hash)
  return hash.digest("hex")
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}
