/** Tracks local server processes that olc itself started. */
import { randomBytes } from "node:crypto"
import {
  mkdir,
  readdir,
  readFile,
  rm as removeFiles,
  writeFile
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { OLC_VERSION } from "./version.js"

const SCHEMA_VERSION = 1
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
}

function processDirectory(): string {
  return path.join(
    process.env.OLC_DATA_DIR || path.join(os.homedir(), ".olc"),
    PROCESS_DIRECTORY
  )
}

function parseManagedProcess(value: unknown): ManagedProcess | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION ||
    typeof record.service !== "string" ||
    !/^[a-z][a-z0-9-]{0,31}$/.test(record.service) ||
    typeof record.url !== "string" ||
    !Number.isSafeInteger(record.pid) ||
    typeof record.pid !== "number" ||
    record.pid < 2 ||
    typeof record.olcVersion !== "string" ||
    typeof record.startedAt !== "string" ||
    !Number.isFinite(Date.parse(record.startedAt))
  )
    return
  try {
    const url = new URL(record.url)
    if (
      url.protocol !== "http:" ||
      !url.port ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return
  } catch {
    return
  }
  return {
    service: record.service,
    url: record.url,
    pid: record.pid,
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

/** Persist a process only after its server has passed startup readiness. */
export async function registerManagedProcess(input: {
  service: string
  url: string
  pid: number
}): Promise<string> {
  const processRecord = parseManagedProcess({
    schemaVersion: SCHEMA_VERSION,
    service: input.service,
    url: input.url,
    pid: input.pid,
    olcVersion: OLC_VERSION,
    startedAt: new Date().toISOString()
  })
  if (!processRecord)
    throw new Error("Cannot register an invalid olc-managed process.")
  const directory = processDirectory()
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const id = [
    processRecord.service,
    processRecord.pid,
    Date.now(),
    randomBytes(4).toString("hex")
  ].join("-")
  const record: StoredManagedProcess = {
    schemaVersion: SCHEMA_VERSION,
    ...processRecord
  }
  await writeFile(
    path.join(directory, `${id}.json`),
    `${JSON.stringify(record)}\n`,
    { mode: 0o600, flag: "wx" }
  )
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

  const processes: ManagedProcess[] = []
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue
    const filePath = path.join(directory, entry)
    try {
      const record = parseManagedProcess(
        JSON.parse(await readFile(filePath, "utf8"))
      )
      if (!record) continue
      if (!isProcessAlive(record.pid)) {
        await removeFiles(filePath, { force: true }).catch(() => undefined)
        continue
      }
      processes.push(record)
    } catch {
      // A partial record from a crash or user-edited file is ignored.
    }
  }
  return processes
}
