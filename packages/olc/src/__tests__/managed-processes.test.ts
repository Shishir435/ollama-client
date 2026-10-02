import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const listenersMock = vi.hoisted(() => vi.fn())
const processIdentityMock = vi.hoisted(() => vi.fn())

vi.mock("../ollama/process.js", () => ({
  listeners: listenersMock,
  processIdentity: processIdentityMock
}))

import {
  listManagedProcesses,
  registerManagedProcess,
  unregisterManagedProcess
} from "../managed-processes.js"

let tempRoot: string

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "olc-managed-processes-"))
  vi.stubEnv("OLC_DATA_DIR", tempRoot)
  listenersMock.mockReset()
  processIdentityMock.mockReset()
  listenersMock.mockResolvedValue([
    {
      pid: process.pid,
      identity: "test-process-identity",
      host: "127.0.0.1",
      executable: "olc",
      uid: 0
    }
  ])
  processIdentityMock.mockResolvedValue({
    pid: process.pid,
    identity: "test-process-identity",
    executable: "olc",
    uid: 0
  })
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(tempRoot, { recursive: true, force: true })
})

describe("managed process registry", () => {
  it("records only a live OLC-started server and removes its record", async () => {
    const id = await registerManagedProcess({
      service: "opencode",
      url: "http://127.0.0.1:8084",
      pid: process.pid
    })
    const files = await readdir(path.join(tempRoot, "processes"))
    const stored = JSON.parse(
      await readFile(path.join(tempRoot, "processes", files[0]), "utf8")
    )

    expect(stored).toMatchObject({
      schemaVersion: 2,
      service: "opencode",
      url: "http://127.0.0.1:8084",
      pid: process.pid
    })
    expect(
      process.platform === "win32" ? listenersMock : processIdentityMock
    ).toHaveBeenCalledWith(process.platform === "win32" ? 8084 : process.pid)
    expect(await listManagedProcesses()).toEqual([
      expect.objectContaining({
        service: "opencode",
        url: "http://127.0.0.1:8084",
        pid: process.pid,
        olcVersion: expect.any(String),
        startedAt: expect.any(String)
      })
    ])

    await unregisterManagedProcess(id)
    expect(await listManagedProcesses()).toEqual([])
  })

  it("warns about unverified processes and retains their records for retry", async () => {
    await registerManagedProcess({
      service: "opencode",
      url: "http://127.0.0.1:8084",
      pid: process.pid
    })
    const verifier =
      process.platform === "win32" ? listenersMock : processIdentityMock
    verifier.mockRejectedValueOnce(new Error("Identity inspection failed"))
    const warnings: string[] = []

    expect(await listManagedProcesses(warnings)).toEqual([])
    expect(warnings).toEqual([
      `Local olc process opencode (PID ${process.pid}) could not be verified and was omitted from this listing.`
    ])
    expect(await readdir(path.join(tempRoot, "processes"))).toHaveLength(1)
    const retryWarnings: string[] = []
    expect(await listManagedProcesses(retryWarnings)).toEqual([
      expect.objectContaining({ service: "opencode", pid: process.pid })
    ])
    expect(retryWarnings).toEqual([])
  })

  it("accepts HTTP's default port 80 and prunes a reused PID", async () => {
    await registerManagedProcess({
      service: "ollama",
      url: "http://127.0.0.1:80",
      pid: process.pid
    })
    expect(
      process.platform === "win32" ? listenersMock : processIdentityMock
    ).toHaveBeenCalledWith(process.platform === "win32" ? 80 : process.pid)
    expect(await listManagedProcesses()).toEqual([
      expect.objectContaining({ service: "ollama", pid: process.pid })
    ])

    listenersMock.mockResolvedValue([
      {
        pid: process.pid,
        identity: "different-process-identity",
        host: "127.0.0.1",
        executable: "other",
        uid: 0
      }
    ])
    processIdentityMock.mockResolvedValue({
      pid: process.pid,
      identity: "different-process-identity",
      executable: "other",
      uid: 0
    })
    expect(await listManagedProcesses()).toEqual([])
    expect(await readdir(path.join(tempRoot, "processes"))).toEqual([])
  })

  it("checks several managed process identities concurrently", async () => {
    await registerManagedProcess({
      service: "ollama",
      url: "http://127.0.0.1:11434",
      pid: process.pid
    })
    await registerManagedProcess({
      service: "opencode",
      url: "http://127.0.0.1:8084",
      pid: process.pid
    })

    const verifier =
      process.platform === "win32" ? listenersMock : processIdentityMock
    verifier.mockClear()
    let releaseChecks: () => void = () => undefined
    let notifyBothChecks: () => void = () => undefined
    const checkGate = new Promise<void>((resolve) => {
      releaseChecks = resolve
    })
    const bothChecks = new Promise<void>((resolve) => {
      notifyBothChecks = resolve
    })
    verifier.mockImplementation(async () => {
      if (verifier.mock.calls.length === 2) notifyBothChecks()
      await checkGate
      if (process.platform === "win32")
        return [
          {
            pid: process.pid,
            identity: "test-process-identity",
            host: "127.0.0.1",
            executable: "olc",
            uid: 0
          }
        ]
      return {
        pid: process.pid,
        identity: "test-process-identity",
        executable: "olc",
        uid: 0
      }
    })

    const listing = listManagedProcesses()
    await bothChecks
    releaseChecks()
    await expect(listing).resolves.toHaveLength(2)
  })

  it("rejects records that could not have been created by olc", async () => {
    await expect(
      registerManagedProcess({
        service: "../other",
        url: "file:///etc/passwd",
        pid: 0
      })
    ).rejects.toThrow("Cannot register an invalid olc-managed process.")
    await expect(
      readdir(path.join(tempRoot, "processes"))
    ).rejects.toMatchObject({ code: "ENOENT" })
  })
})
