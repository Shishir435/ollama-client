/**
 * Replacing an installed olc with a newer release archive.
 *
 * This is the same sequence `olc.sh` performs — download, verify the published
 * SHA-256, unpack, swap the directory, keep a backup until the swap succeeds —
 * done in the process that is being replaced. That last part is what the rest of
 * this module is about: an update that goes wrong must not leave the user
 * without a working olc, and the only thing standing between them and that is
 * this code, because a broken install cannot fix itself.
 *
 * - Nothing is downloaded and executed from a URL the user typed. The archive
 *   comes from the release the API named, and it is only unpacked after its
 *   checksum matches the checksum published beside it.
 * - A failed swap puts the previous version back. The old directory is moved
 *   aside rather than deleted, so a bad download or a refused rename costs
 *   nothing.
 * - One update per installation at a time, enforced across processes by an
 *   exclusive lock file, because two swaps interleaved is how a root gets
 *   renamed out from under the process about to rename it.
 * - The window where the installation directory does not exist is closed against
 *   SIGINT and SIGTERM, and what a kill that cannot be caught leaves behind is a
 *   complete previous version under a name the next run restores from.
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
import { errorCode, isRecord } from "../util.js"
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
  const staged = path.join(
    parent,
    `.olc-update-${randomBytes(6).toString("hex")}`
  )
  const backup = previousPath(target.root)
  try {
    await withUpdateLock(target.root, async () => {
      await recoverInterruptedUpdate(target.root)
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
    })
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
    await fs.rm(staged, { recursive: true, force: true })
  }
}

/**
 * Where an interrupted update leaves the version it was replacing.
 *
 * The name is derived from the installation rather than randomized, for two
 * reasons: the next run can find it without guessing, and two installations
 * sharing a parent directory cannot collide over it.
 */
export function previousPath(root: string): string {
  return path.join(path.dirname(root), `.olc-previous-${path.basename(root)}`)
}

/**
 * Put back an installation a previous run was interrupted while replacing.
 *
 * The only state worth restoring is a missing root beside a surviving backup:
 * that pair can only come from a swap that died between its two renames. If the
 * root is there, the backup is debris from a finished or reinstalled update, and
 * restoring it would overwrite a working install with an older one.
 */
export async function recoverInterruptedUpdate(root: string): Promise<boolean> {
  const previous = previousPath(root)
  if (!(await exists(previous))) return false
  if (await exists(root)) {
    await fs.rm(previous, { recursive: true, force: true })
    return false
  }
  await fs.rename(previous, root)
  return true
}

/**
 * Replace the installation, keeping the old one until the new one is in place.
 *
 * Two renames on one filesystem cannot be made one atomic operation portably —
 * Node exposes no directory-exchange call — so the window between them is closed
 * from the other side instead: SIGINT and SIGTERM are held off for its duration,
 * and what survives a kill that cannot be caught is a complete previous version
 * under a name the next run knows to restore.
 */
async function swap({
  root,
  staged,
  backup
}: {
  root: string
  staged: string
  backup: string
}): Promise<void> {
  const hold = () => {}
  process.on("SIGINT", hold)
  process.on("SIGTERM", hold)
  const hadPrevious = await exists(root)
  try {
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
  } finally {
    process.off("SIGINT", hold)
    process.off("SIGTERM", hold)
  }
}

const LOCK_STALE_MS = 10 * 60_000

/**
 * Serialize updates of one installation across processes.
 *
 * Two updates replacing the same directory at once is how one of them ends up
 * renaming a root the other already moved. The lock is an exclusive file
 * creation, which is atomic on every filesystem this runs on; a lock whose owner
 * is gone, or that is older than any plausible update, is taken over rather than
 * left to block forever.
 */
export async function withUpdateLock<T>(
  root: string,
  run: () => Promise<T>
): Promise<T> {
  const lock = path.join(
    path.dirname(root),
    `.olc-update-${path.basename(root)}.lock`
  )
  await claimLock(lock)
  try {
    return await run()
  } finally {
    await fs.rm(lock, { force: true })
  }
}

async function claimLock(lock: string): Promise<void> {
  const mine = JSON.stringify({ pid: process.pid, at: Date.now() })
  try {
    await fs.writeFile(lock, mine, { flag: "wx" })
    return
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error
  }
  const holder = await readLock(lock)
  if (holder && holder.at > Date.now() - LOCK_STALE_MS && isRunning(holder.pid))
    throw new Error(
      `Another olc update is already running (PID ${holder.pid}). Wait for it to finish, or remove ${lock} if it did not.`
    )
  await fs.rm(lock, { force: true })
  try {
    await fs.writeFile(lock, mine, { flag: "wx" })
  } catch {
    throw new Error(
      `Another olc update claimed ${lock} at the same moment. Try again.`
    )
  }
}

interface LockHolder {
  pid: number
  at: number
}

async function readLock(lock: string): Promise<LockHolder | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(lock, "utf8"))
    if (!isRecord(parsed)) return undefined
    const { pid, at } = parsed
    if (typeof pid === "number" && typeof at === "number") return { pid, at }
  } catch {
    /* An unreadable lock says nothing, so it is treated as abandoned. */
  }
  return undefined
}

/** Signal 0 tests for the process without touching it. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return errorCode(error) !== "ESRCH"
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
