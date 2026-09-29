import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const dockerMock = vi.hoisted(() => vi.fn())

vi.mock("node:child_process", () => {
  const execFile = Object.assign(() => undefined, {
    [Symbol.for("nodejs.util.promisify.custom")]: dockerMock
  })
  return { execFile }
})

import { runManagedService } from "../managed-services.js"
import { OLC_VERSION } from "../version.js"

const servicesRoot = fileURLToPath(new URL("../../services", import.meta.url))
const searxngAssets = path.join(servicesRoot, "searxng")
const dataRoot = path.join("services", "searxng")
const marker = `${JSON.stringify({ schemaVersion: 1, service: "searxng" })}\n`

let tempRoot: string
let dataDir: string

function dockerError(message: string): Error & { stderr: string } {
  const error = new Error(message) as Error & { stderr: string }
  error.stderr = message
  return error
}

function mockDocker(
  handler: (
    args: string[],
    options: { cwd?: string } | undefined
  ) =>
    | Promise<{ stdout?: string; stderr?: string }>
    | { stdout?: string; stderr?: string }
): void {
  dockerMock.mockImplementation(
    async (_command: string, args: string[], options: { cwd?: string }) =>
      handler(args, options)
  )
}

function basicDocker(args: string[]): { stdout: string; stderr: string } {
  if (args[0] === "info") return { stdout: "27.0", stderr: "" }
  if (args[0] === "compose" && args[1] === "version")
    return { stdout: "Docker Compose version v2", stderr: "" }
  return { stdout: "", stderr: "" }
}

function successResponse(): Response {
  return new Response(null, { status: 200 })
}

async function writeOwnedSearxng(port: number): Promise<void> {
  const coreConfig = path.join(dataDir, "core-config")
  await mkdir(coreConfig, { recursive: true })
  await writeFile(path.join(dataDir, ".olc-managed.json"), marker)
  await writeFile(
    path.join(dataDir, "docker-compose.yml"),
    await readFile(path.join(searxngAssets, "docker-compose.yml"), "utf8")
  )
  await writeFile(
    path.join(dataDir, ".env"),
    `SEARXNG_VERSION=latest\nSEARXNG_HOST_PORT=${port}\nOLC_VERSION=${OLC_VERSION}\n`
  )
  const settings = await readFile(
    path.join(searxngAssets, "settings.yml.template"),
    "utf8"
  )
  await writeFile(
    path.join(coreConfig, "settings.yml"),
    settings
      .replaceAll("__HOST_PORT__", String(port))
      .replaceAll("__SECRET_KEY__", "test-secret")
  )
}

interface TestContainer {
  state: string
  labels: string
}

async function layaReplacementDocker(
  args: string[],
  containers: Map<string, TestContainer>
): Promise<{ stdout: string; stderr: string }> {
  switch (args[0]) {
    case "inspect": {
      const name = args.at(-1) as string
      const container = containers.get(name)
      if (!container) throw dockerError(`No such container: ${name}`)
      return {
        stdout:
          args[2] === "{{.State.Status}}" ? container.state : container.labels,
        stderr: ""
      }
    }
    case "image":
      return { stdout: "sha256:test", stderr: "" }
    case "stop": {
      const container = containers.get(args[1] as string)
      if (container) container.state = "exited"
      return { stdout: "", stderr: "" }
    }
    case "rename": {
      const sourceName = args[1] as string
      const source = containers.get(sourceName)
      if (!source) throw dockerError(`No such container: ${sourceName}`)
      containers.delete(sourceName)
      containers.set(args[2] as string, source)
      return { stdout: "", stderr: "" }
    }
    case "run":
      throw dockerError("replacement container failed")
    case "start": {
      const container = containers.get(args[1] as string)
      if (container) container.state = "running"
      return { stdout: "", stderr: "" }
    }
    default:
      return basicDocker(args)
  }
}

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "olc-managed-services-"))
  dataDir = path.join(tempRoot, dataRoot)
  vi.stubEnv("OLC_DATA_DIR", tempRoot)
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => successResponse())
  )
  dockerMock.mockReset()
  process.exitCode = 0
})

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await rm(tempRoot, { recursive: true, force: true })
})

describe("managed Docker service lifecycle", () => {
  it("refuses to run Compose or purge an unowned SearXNG directory", async () => {
    await mkdir(dataDir, { recursive: true })
    await writeFile(path.join(dataDir, "docker-compose.yml"), "services: {}\n")

    await expect(
      runManagedService("searxng", "rm", undefined, true, servicesRoot)
    ).rejects.toThrow("not recognized as olc-managed")

    expect(dockerMock).not.toHaveBeenCalled()
    expect(await readdir(dataDir)).toEqual(["docker-compose.yml"])
  })

  it("creates an owned SearXNG project and keeps its files through stop and rm", async () => {
    const calls: string[][] = []
    mockDocker(async (args) => {
      calls.push(args)
      return basicDocker(args)
    })

    await runManagedService("searxng", "start", undefined, false, servicesRoot)
    expect(
      await readFile(path.join(dataDir, ".olc-managed.json"), "utf8")
    ).toBe(marker)
    expect(await readFile(path.join(dataDir, ".env"), "utf8")).toContain(
      "SEARXNG_HOST_PORT=8080"
    )
    expect(
      calls.some((args) => args[0] === "compose" && args.includes("up"))
    ).toBe(true)

    await runManagedService("searxng", "stop", undefined, false, servicesRoot)
    await runManagedService("searxng", "rm", undefined, false, servicesRoot)
    expect(
      calls.some((args) => args[0] === "compose" && args.includes("stop"))
    ).toBe(true)
    expect(
      calls.some((args) => args[0] === "compose" && args.includes("down"))
    ).toBe(true)
    expect(
      await readFile(path.join(dataDir, ".olc-managed.json"), "utf8")
    ).toBe(marker)
    expect(await readFile(path.join(dataDir, ".env"), "utf8")).toContain(
      "SEARXNG_HOST_PORT=8080"
    )
  })

  it("purges only an owned SearXNG project and its Compose volumes", async () => {
    await writeOwnedSearxng(8080)
    await writeFile(path.join(dataDir, "keep.txt"), "unrelated local file")
    const calls: string[][] = []
    mockDocker(async (args) => {
      calls.push(args)
      return basicDocker(args)
    })

    await runManagedService("searxng", "rm", undefined, true, servicesRoot)

    expect(
      calls.find((args) => args[0] === "compose" && args.includes("down"))
    ).toEqual(expect.arrayContaining(["--volumes"]))
    expect(await readdir(dataDir)).toEqual(["keep.txt"])
    expect(await readFile(path.join(dataDir, "keep.txt"), "utf8")).toBe(
      "unrelated local file"
    )
  })

  it("restores the previous SearXNG port config and running state after a failed change", async () => {
    let failNextUp = false
    const calls: string[][] = []
    mockDocker(async (args) => {
      calls.push(args)
      if (args[0] === "compose" && args.includes("ps"))
        return { stdout: "core\nvalkey\n", stderr: "" }
      if (args[0] === "compose" && args.includes("up") && failNextUp) {
        failNextUp = false
        throw dockerError(
          "Bind for 127.0.0.1 failed: port is already allocated"
        )
      }
      return basicDocker(args)
    })

    await runManagedService("searxng", "start", 18080, false, servicesRoot)
    const originalEnv = await readFile(path.join(dataDir, ".env"), "utf8")
    const originalSettings = await readFile(
      path.join(dataDir, "core-config", "settings.yml"),
      "utf8"
    )
    failNextUp = true

    await expect(
      runManagedService("searxng", "start", 18081, false, servicesRoot)
    ).rejects.toThrow("Port 18081 is already in use")

    expect(await readFile(path.join(dataDir, ".env"), "utf8")).toBe(originalEnv)
    expect(
      await readFile(path.join(dataDir, "core-config", "settings.yml"), "utf8")
    ).toBe(originalSettings)
    const upCalls = calls.filter(
      (args) => args[0] === "compose" && args.includes("up")
    )
    expect(upCalls).toHaveLength(3)
  })

  it("guards a Laya port change even while upgrading an older container", async () => {
    mockDocker(async (args) => {
      if (args[0] === "inspect") {
        const name = args.at(-1)
        if (name === "olc-laya-rollback") throw dockerError("No such container")
        if (args[2] === "{{.State.Status}}")
          return { stdout: "running", stderr: "" }
        return { stdout: "true|laya|8086|0.13.0", stderr: "" }
      }
      return basicDocker(args)
    })

    await expect(
      runManagedService("laya", "start", 18080, false, servicesRoot)
    ).rejects.toThrow("Stop and remove that container before changing ports")
    expect(dockerMock.mock.calls.some(([, args]) => args[0] === "build")).toBe(
      false
    )
    expect(dockerMock.mock.calls.some(([, args]) => args[0] === "rename")).toBe(
      false
    )
  })

  it("restores the previous Laya container when a replacement fails to start", async () => {
    const containers = new Map([
      ["olc-laya", { state: "running", labels: "true|laya|8086|0.13.0" }]
    ])
    const calls: string[][] = []
    mockDocker(async (args) => {
      calls.push(args)
      return layaReplacementDocker(args, containers)
    })

    await expect(
      runManagedService("laya", "start", undefined, false, servicesRoot)
    ).rejects.toThrow("the previous server was restored")

    expect(containers.get("olc-laya")).toEqual({
      state: "running",
      labels: "true|laya|8086|0.13.0"
    })
    expect(containers.has("olc-laya-rollback")).toBe(false)
    expect(
      calls.some(
        (args) => args[0] === "rename" && args[2] === "olc-laya-rollback"
      )
    ).toBe(true)
    expect(
      calls.some(
        (args) => args[0] === "rename" && args[1] === "olc-laya-rollback"
      )
    ).toBe(true)
  })
})
