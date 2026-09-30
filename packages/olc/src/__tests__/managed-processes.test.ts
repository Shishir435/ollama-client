import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const listenersMock = vi.hoisted(() => vi.fn())

vi.mock("../ollama/process.js", () => ({ listeners: listenersMock }))

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
  listenersMock.mockResolvedValue([
    {
      pid: process.pid,
      identity: "test-process-identity",
      host: "127.0.0.1",
      executable: "olc",
      uid: 0
    }
  ])
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
    expect(listenersMock).toHaveBeenCalledWith(8084)
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

  it("accepts HTTP's default port 80 and prunes a reused PID", async () => {
    await registerManagedProcess({
      service: "ollama",
      url: "http://127.0.0.1:80",
      pid: process.pid
    })
    expect(listenersMock).toHaveBeenCalledWith(80)
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
    expect(await listManagedProcesses()).toEqual([])
    expect(await readdir(path.join(tempRoot, "processes"))).toEqual([])
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
