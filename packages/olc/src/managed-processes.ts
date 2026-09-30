/** Tracks local server processes that olc itself started. */
import { randomBytes } from "node:crypto"
import {
  mkdir,
  readdir,
  readFile,
  rm as removeFiles,
  rename as renameFile,
  writeFile
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { listeners, processIdentity } from "./ollama/process.js"
import { OLC_VERSION } from "./version.js"

const SCHEMA_VERSION = 2
const PROCESS_DIRECTORY = "processes"

export interface ManagedProcess {
  service: string
  url: string
  pid: number
  olcVersion: string
  startedAt: string
}

interface StoredManagedProcess extends ManagedProcess {
  schemaVersion: number
  port: number
  identity: string
}

function processDirectory(): string {
  return path.join(
    process.env.OLC_DATA_DIR || path.join(os.homedir(), ".olc"),
    PROCESS_DIRECTORY
  )
}

function managedProcessFields(
  service: unknown,
  urlValue: unknown,
  pid: unknown
): { service: string; url: string; pid: number; port: number } | undefined {
  if (
    typeof service !== "string" ||
    !/^[a-z][a-z0-9-]{0,31}$/.test(service) ||
    typeof urlValue !== "string" ||
    !Number.isSafeInteger(pid) ||
    typeof pid !== "number" ||
    pid < 2
  )
    return
  try {
    const url = new URL(urlValue)
    const port = Number(url.port || 80)
    if (
      url.protocol !== "http:" ||
      !url.hostname ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535 ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return
    return { service, url: urlValue, pid, port }
  } catch {
    return
  }
}

function parseManagedProcess(value: unknown): StoredManagedProcess | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const record = value as Record<string, unknown>
  const fields = managedProcessFields(record.service, record.url, record.pid)
  if (
    record.schemaVersion !== SCHEMA_VERSION ||
    !fields ||
    record.port !== fields.port ||
    typeof record.identity !== "string" ||
    !record.identity ||
    typeof record.olcVersion !== "string" ||
    typeof record.startedAt !== "string" ||
    !Number.isFinite(Date.parse(record.startedAt))
  )
    return
  return {
    ...fields,
    schemaVersion: SCHEMA_VERSION,
    port: fields.port,
    identity: record.identity,
    olcVersion: record.olcVersion,
    startedAt: record.startedAt
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

async function managedProcessIdentity(
  pid: number,
  port: number
): Promise<string | undefined> {
  if (process.platform === "win32") {
    const listener = (await listeners(port)).find((item) => item.pid === pid)
    return listener?.identity
  }
  return (await processIdentity(pid)).identity
}

/** Persist a process only after its server has passed startup readiness. */
export async function registerManagedProcess(input: {
  service: string
  url: string
  pid: number
}): Promise<string> {
  const fields = managedProcessFields(input.service, input.url, input.pid)
  if (!fields)
    throw new Error("Cannot register an invalid olc-managed process.")
  const identity = await managedProcessIdentity(fields.pid, fields.port)
  if (!identity)
    throw new Error("Cannot verify the olc-managed server process.")
  const record = parseManagedProcess({
    schemaVersion: SCHEMA_VERSION,
    ...fields,
    port: fields.port,
    identity,
    olcVersion: OLC_VERSION,
    startedAt: new Date().toISOString()
  })
  if (!record)
    throw new Error("Cannot register an invalid olc-managed process.")

  const directory = processDirectory()
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const id = [
    record.service,
    record.pid,
    Date.now(),
    randomBytes(4).toString("hex")
  ].join("-")
  const temporaryPath = path.join(directory, `${id}.tmp`)
  const finalPath = path.join(directory, `${id}.json`)
  try {
    await writeFile(temporaryPath, `${JSON.stringify(record)}\n`, {
      mode: 0o600,
      flag: "wx"
    })
    await renameFile(temporaryPath, finalPath)
  } catch (error) {
    await removeFiles(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
  return id
}

/** Remove only records created by this module; never accept a path from callers. */
export async function unregisterManagedProcess(id: string): Promise<void> {
  if (!/^[a-z][a-z0-9-]{0,31}-\d+-\d+-[0-9a-f]{8}$/.test(id)) return
  await removeFiles(path.join(processDirectory(), `${id}.json`), {
    force: true
  })
}

/** Ignore stale PID records left by crashes and malformed local state. */
export async function listManagedProcesses(): Promise<ManagedProcess[]> {
  const directory = processDirectory()
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }

  const candidates: Array<{
    filePath: string
    record: StoredManagedProcess
  }> = []
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue
    const filePath = path.join(directory, entry)
    let record: StoredManagedProcess | undefined
    try {
      record = parseManagedProcess(JSON.parse(await readFile(filePath, "utf8")))
    } catch {
      // Malformed local state is ignored without changing it.
      continue
    }
    if (!record) continue
    if (!isProcessAlive(record.pid)) {
      await removeFiles(filePath, { force: true }).catch(() => undefined)
      continue
    }
    candidates.push({ filePath, record })
  }

  const processes = await Promise.all(
    candidates.map(async ({ filePath, record }) => {
      let identity: string | undefined
      try {
        identity = await managedProcessIdentity(record.pid, record.port)
      } catch {
        // Process identity inspection can fail transiently; keep the record for a later listing.
        return undefined
      }
      if (identity !== record.identity) {
        await removeFiles(filePath, { force: true }).catch(() => undefined)
        return undefined
      }
      return {
        service: record.service,
        url: record.url,
        pid: record.pid,
        olcVersion: record.olcVersion,
        startedAt: record.startedAt
      }
    })
  )
  return processes.filter(
    (record): record is ManagedProcess => record !== undefined
  )
}
