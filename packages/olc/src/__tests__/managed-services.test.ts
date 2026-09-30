import { createHash } from "node:crypto"
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
const listenersMock = vi.hoisted(() => vi.fn())
const processIdentityMock = vi.hoisted(() => vi.fn())

vi.mock("../ollama/process.js", () => ({
  listeners: listenersMock,
  processIdentity: processIdentityMock
}))

vi.mock("node:child_process", () => {
  const execFile = Object.assign(() => undefined, {
    [Symbol.for("nodejs.util.promisify.custom")]: dockerMock
  })
  return { execFile }
})

import { registerManagedProcess } from "../managed-processes.js"
import { listManagedServers, runManagedService } from "../managed-services.js"
import { OLC_VERSION } from "../version.js"

const servicesRoot = fileURLToPath(new URL("../../services", import.meta.url))
const searxngAssets = path.join(servicesRoot, "searxng")
const dataRoot = path.join("services", "searxng")
const searxngDefaultVersion = "2026.9.25-12f8b6515"
const bundledCompose = await readFile(
  path.join(searxngAssets, "docker-compose.yml"),
  "utf8"
)
const markerForCompose = (compose: string, composeManaged = true) =>
  `${JSON.stringify({
    schemaVersion: 2,
    service: "searxng",
    composeSha256: createHash("sha256").update(compose).digest("hex"),
    composeManaged
  })}\n`
const legacyMarker = `${JSON.stringify({ schemaVersion: 1, service: "searxng" })}\n`
const marker = markerForCompose(bundledCompose)

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

async function writeOwnedSearxng(
  port: number,
  version = "latest",
  managedVersion?: string,
  compose = bundledCompose,
  legacyOwnership = false
): Promise<void> {
  const coreConfig = path.join(dataDir, "core-config")
  await mkdir(coreConfig, { recursive: true })
  await writeFile(
    path.join(dataDir, ".olc-managed.json"),
    legacyOwnership ? legacyMarker : markerForCompose(compose)
  )
  await writeFile(path.join(dataDir, "docker-compose.yml"), compose)
  await writeFile(
    path.join(dataDir, ".env"),
    `SEARXNG_VERSION=${version}\nSEARXNG_HOST_PORT=${port}\nOLC_VERSION=${OLC_VERSION}\n${managedVersion ? `# OLC_SEARXNG_VERSION_DEFAULT=${managedVersion}\n` : ""}`
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
    case "rm":
      containers.delete(args.at(-1) as string)
      return { stdout: "", stderr: "" }
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
  process.exitCode = 0
})

afterEach(async () => {
  vi.restoreAllMocks()
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
    const env = await readFile(path.join(dataDir, ".env"), "utf8")
    expect(env).toContain(`SEARXNG_VERSION=${searxngDefaultVersion}`)
    expect(env).toContain(
      `# OLC_SEARXNG_VERSION_DEFAULT=${searxngDefaultVersion}`
    )
    expect(
      await readFile(path.join(dataDir, "docker-compose.yml"), "utf8")
    ).toContain(`SEARXNG_VERSION:-${searxngDefaultVersion}`)
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

  it("purges an owned marker left by a failed first start", async () => {
    mockDocker(async (args) => {
      if (args[0] === "info") throw dockerError("Docker daemon unavailable")
      return basicDocker(args)
    })

    await expect(
      runManagedService("searxng", "start", undefined, false, servicesRoot)
    ).rejects.toThrow("daemon is unavailable")
    expect(
      await readFile(path.join(dataDir, ".olc-managed.json"), "utf8")
    ).toBe(marker)
    expect(await readdir(dataDir)).toEqual([".olc-managed.json"])
    await mkdir(path.join(dataDir, "core-config"), { recursive: true })
    await writeFile(path.join(dataDir, ".env"), "SEARXNG_VERSION=latest\n")
    await writeFile(
      path.join(dataDir, "core-config", "settings.yml"),
      "user-owned: true\n"
    )

    await runManagedService("searxng", "rm", undefined, true, servicesRoot)

    expect(dockerMock).toHaveBeenCalledTimes(1)
    expect(await readFile(path.join(dataDir, ".env"), "utf8")).toBe(
      "SEARXNG_VERSION=latest\n"
    )
    expect(
      await readFile(path.join(dataDir, "core-config", "settings.yml"), "utf8")
    ).toBe("user-owned: true\n")
    await expect(
      readFile(path.join(dataDir, ".olc-managed.json"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("finishes a purge interrupted after the Compose file was removed", async () => {
    await writeOwnedSearxng(8080)
    const markerPath = path.join(dataDir, ".olc-managed.json")
    const pendingMarker = JSON.parse(await readFile(markerPath, "utf8"))
    pendingMarker.purgePending = true
    await writeFile(markerPath, `${JSON.stringify(pendingMarker)}\n`)
    await rm(path.join(dataDir, "docker-compose.yml"))
    mockDocker(async (args) => basicDocker(args))

    await runManagedService("searxng", "rm", undefined, true, servicesRoot)

    expect(dockerMock).not.toHaveBeenCalled()
    await expect(
      readFile(path.join(dataDir, ".env"), "utf8")
    ).rejects.toMatchObject({
      code: "ENOENT"
    })
    await expect(
      readFile(path.join(dataDir, "core-config", "settings.yml"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" })
    await expect(readFile(markerPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    })
  })

  it("refreshes the owned Compose file and updates only olc-managed image defaults", async () => {
    const oldVersion = "2026.6.19-93f66bfb4"
    const previousCompose = bundledCompose.replace(
      `SEARXNG_VERSION:-${searxngDefaultVersion}`,
      "SEARXNG_VERSION:-latest"
    )
    await writeOwnedSearxng(8080, oldVersion, oldVersion, previousCompose, true)
    const settingsPath = path.join(dataDir, "core-config", "settings.yml")
    const originalSettings = await readFile(settingsPath, "utf8")
    mockDocker(async (args) => basicDocker(args))

    await runManagedService("searxng", "start", undefined, false, servicesRoot)

    const env = await readFile(path.join(dataDir, ".env"), "utf8")
    expect(env).toContain(`SEARXNG_VERSION=${searxngDefaultVersion}`)
    expect(env).toContain(
      `# OLC_SEARXNG_VERSION_DEFAULT=${searxngDefaultVersion}`
    )
    expect(await readFile(settingsPath, "utf8")).toBe(originalSettings)
    expect(
      await readFile(path.join(dataDir, "docker-compose.yml"), "utf8")
    ).toBe(
      await readFile(path.join(searxngAssets, "docker-compose.yml"), "utf8")
    )
  })

  it("preserves an unmarked legacy SearXNG image version when refreshing old Compose", async () => {
    const previousCompose = bundledCompose.replace(
      `SEARXNG_VERSION:-${searxngDefaultVersion}`,
      "SEARXNG_VERSION:-latest"
    )
    await writeOwnedSearxng(8080, "latest", undefined, previousCompose, true)
    mockDocker(async (args) => basicDocker(args))

    await runManagedService("searxng", "start", undefined, false, servicesRoot)

    const env = await readFile(path.join(dataDir, ".env"), "utf8")
    expect(env).toContain("SEARXNG_VERSION=latest")
    expect(env).not.toContain("OLC_SEARXNG_VERSION_DEFAULT=")
    expect(
      await readFile(path.join(dataDir, "docker-compose.yml"), "utf8")
    ).toBe(bundledCompose)
  })

  it("preserves user edits to the owned Compose file when starting", async () => {
    await writeOwnedSearxng(8080)
    const composePath = path.join(dataDir, "docker-compose.yml")
    const customizedCompose = `${bundledCompose}\n# user customizations stay in place\n`
    await writeFile(composePath, customizedCompose)
    mockDocker(async (args) => basicDocker(args))

    await runManagedService("searxng", "start", undefined, false, servicesRoot)

    expect(await readFile(composePath, "utf8")).toBe(customizedCompose)
    expect(
      await readFile(path.join(dataDir, ".olc-managed.json"), "utf8")
    ).toContain('"composeManaged":false')
  })

  it("recovers an interrupted Compose refresh without disabling future updates", async () => {
    const previousCompose = bundledCompose.replace(
      `SEARXNG_VERSION:-${searxngDefaultVersion}`,
      "SEARXNG_VERSION:-latest"
    )
    await writeOwnedSearxng(8080, "latest", undefined, previousCompose)
    const composePath = path.join(dataDir, "docker-compose.yml")
    await writeFile(composePath, bundledCompose)
    mockDocker(async (args) => basicDocker(args))

    await runManagedService("searxng", "status", undefined, false, servicesRoot)

    expect(
      await readFile(path.join(dataDir, ".olc-managed.json"), "utf8")
    ).toBe(marker)
  })

  it("finalizes a journaled Compose refresh after a crash", async () => {
    const previousCompose = bundledCompose.replace(
      `SEARXNG_VERSION:-${searxngDefaultVersion}`,
      "SEARXNG_VERSION:-latest"
    )
    await writeOwnedSearxng(8080, "latest", undefined, previousCompose)
    const markerPath = path.join(dataDir, ".olc-managed.json")
    const refreshMarker = JSON.parse(await readFile(markerPath, "utf8"))
    refreshMarker.nextComposeSha256 = createHash("sha256")
      .update(bundledCompose)
      .digest("hex")
    await writeFile(markerPath, `${JSON.stringify(refreshMarker)}\n`)
    await writeFile(path.join(dataDir, "docker-compose.yml"), bundledCompose)
    mockDocker(async (args) => basicDocker(args))

    await runManagedService("searxng", "status", undefined, false, servicesRoot)

    expect(await readFile(markerPath, "utf8")).toBe(marker)
  })

  it("preserves customized services and config when purging SearXNG", async () => {
    await writeOwnedSearxng(8080)
    const customizedCompose = bundledCompose.replace(
      "\nvolumes:\n",
      "\n  user-service:\n    image: example/user-service\n    volumes:\n      - user-data:/data\n\nvolumes:\n  user-data:\n"
    )
    await writeFile(path.join(dataDir, "docker-compose.yml"), customizedCompose)
    const calls: string[][] = []
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
    mockDocker(async (args) => {
      calls.push(args)
      return basicDocker(args)
    })

    await runManagedService("searxng", "rm", undefined, true, servicesRoot)

    const downArgs = calls.find((args) => args.includes("down"))
    expect(downArgs).toContain("--volumes")
    expect(downArgs).toContain("--project-directory")
    expect(downArgs).toContain(dataDir)
    expect(downArgs).toContain(path.join(searxngAssets, "docker-compose.yml"))
    expect(downArgs).not.toContain(path.join(dataDir, "docker-compose.yml"))
    expect(
      await readFile(path.join(dataDir, "docker-compose.yml"), "utf8")
    ).toBe(customizedCompose)
    await expect(
      readFile(path.join(dataDir, ".env"), "utf8")
    ).resolves.toContain("SEARXNG_HOST_PORT=8080")
    await expect(
      readFile(path.join(dataDir, "core-config", "settings.yml"), "utf8")
    ).resolves.toContain("secret_key:")
    const marker = JSON.parse(
      await readFile(path.join(dataDir, ".olc-managed.json"), "utf8")
    )
    expect(marker).toMatchObject({ composeManaged: false })
    expect(marker).not.toHaveProperty("purgePending")
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        "core-config/settings.yml, which contains the SearXNG secret"
      )
    )
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        "remove only the listed files if they are no longer needed; preserve all other files and directories"
      )
    )
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(path.join(dataDir, "core-config", "settings.yml"))
    )
  })

  it("allows lifecycle commands for installations with the previous bundled Compose", async () => {
    const previousCompose = bundledCompose.replace(
      `SEARXNG_VERSION:-${searxngDefaultVersion}`,
      "SEARXNG_VERSION:-latest"
    )
    await writeOwnedSearxng(8080, "latest", undefined, previousCompose, true)
    const calls: string[][] = []
    mockDocker(async (args) => {
      calls.push(args)
      return basicDocker(args)
    })

    await runManagedService("searxng", "status", undefined, false, servicesRoot)
    await runManagedService("searxng", "stop", undefined, false, servicesRoot)
    await runManagedService("searxng", "rm", undefined, false, servicesRoot)

    expect(
      await readFile(path.join(dataDir, "docker-compose.yml"), "utf8")
    ).toBe(previousCompose)
    expect(calls.some((args) => args.includes("ps"))).toBe(true)
    expect(calls.some((args) => args.includes("stop"))).toBe(true)
    expect(calls.some((args) => args.includes("down"))).toBe(true)
  })

  it("recognizes a markerless legacy installation with the previous bundled Compose", async () => {
    const previousCompose = bundledCompose.replace(
      `SEARXNG_VERSION:-${searxngDefaultVersion}`,
      "SEARXNG_VERSION:-latest"
    )
    await writeOwnedSearxng(8080, "latest", undefined, previousCompose, true)
    await rm(path.join(dataDir, ".olc-managed.json"))
    mockDocker(async (args) => basicDocker(args))

    await runManagedService("searxng", "start", undefined, false, servicesRoot)

    expect(
      await readFile(path.join(dataDir, "docker-compose.yml"), "utf8")
    ).toBe(bundledCompose)
    expect(
      await readFile(path.join(dataDir, ".olc-managed.json"), "utf8")
    ).toBe(marker)
  })

  it("restores the previous SearXNG port config and each service's running state", async () => {
    await writeOwnedSearxng(18080)
    const runningServices = new Set(["valkey"])
    const calls: string[][] = []
    mockDocker(async (args) => {
      calls.push(args)
      if (args[0] === "compose" && args.includes("ps"))
        return { stdout: [...runningServices].join("\n"), stderr: "" }
      if (args[0] === "compose" && args.includes("up")) {
        if (!args.includes("--no-deps")) {
          // Model a failed Compose update that starts search before port binding fails.
          runningServices.add("core")
          throw dockerError(
            "Bind for 127.0.0.1 failed: port is already allocated"
          )
        }
        runningServices.add(args.at(-1) as string)
      }
      if (args[0] === "compose" && args.includes("stop")) {
        runningServices.delete(args.at(-1) as string)
      }
      return basicDocker(args)
    })

    const originalEnv = await readFile(path.join(dataDir, ".env"), "utf8")
    const originalSettings = await readFile(
      path.join(dataDir, "core-config", "settings.yml"),
      "utf8"
    )

    await expect(
      runManagedService("searxng", "start", 18081, false, servicesRoot)
    ).rejects.toThrow("Port 18081 is already in use")

    expect(await readFile(path.join(dataDir, ".env"), "utf8")).toBe(originalEnv)
    expect(
      await readFile(path.join(dataDir, "core-config", "settings.yml"), "utf8")
    ).toBe(originalSettings)
    expect([...runningServices]).toEqual(["valkey"])
    expect(calls).toContainEqual([
      "compose",
      "--project-name",
      "olc-searxng",
      "--file",
      "docker-compose.yml",
      "stop",
      "core"
    ])
    expect(
      calls.some(
        (args) =>
          args[0] === "compose" &&
          args.includes("--no-deps") &&
          args.at(-1) === "valkey"
      )
    ).toBe(true)
  })

  it("does not restart a previously stopped SearXNG dependency during rollback", async () => {
    await writeOwnedSearxng(18080)
    const runningServices = new Set(["core"])
    const calls: string[][] = []
    mockDocker(async (args) => {
      calls.push(args)
      if (args[0] === "compose" && args.includes("ps"))
        return { stdout: [...runningServices].join("\n"), stderr: "" }
      if (args[0] === "compose" && args.includes("up")) {
        if (!args.includes("--no-deps")) {
          runningServices.add("valkey")
          throw dockerError(
            "Bind for 127.0.0.1 failed: port is already allocated"
          )
        }
        runningServices.add(args.at(-1) as string)
      }
      if (args[0] === "compose" && args.includes("stop"))
        runningServices.delete(args.at(-1) as string)
      return basicDocker(args)
    })

    await expect(
      runManagedService("searxng", "start", 18081, false, servicesRoot)
    ).rejects.toThrow("Port 18081 is already in use")

    expect([...runningServices]).toEqual(["core"])
    expect(
      calls.some(
        (args) =>
          args[0] === "compose" &&
          args.includes("--no-deps") &&
          args.at(-1) === "core"
      )
    ).toBe(true)
    expect(calls).toContainEqual([
      "compose",
      "--project-name",
      "olc-searxng",
      "--file",
      "docker-compose.yml",
      "stop",
      "valkey"
    ])
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

  it.each([
    "interrupted rename",
    "stale replacement"
  ])("does not restart or wait for Laya during rm recovery after an %s", async (recoveryCase) => {
    const containers = new Map<string, TestContainer>([
      [
        "olc-laya-rollback",
        { state: "exited", labels: "true|laya|8086|0.13.0" }
      ]
    ])
    if (recoveryCase === "stale replacement")
      containers.set("olc-laya", {
        state: "running",
        labels: "true|laya|8086|0.13.0"
      })
    const calls: string[][] = []
    mockDocker(async (args) => {
      calls.push(args)
      return layaReplacementDocker(args, containers)
    })

    await runManagedService("laya", "rm", undefined, false, servicesRoot)

    expect(containers.has("olc-laya")).toBe(false)
    expect(containers.has("olc-laya-rollback")).toBe(false)
    expect(calls.some((args) => args[0] === "start")).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("restores the previous running Laya server when status recovers an interrupted replacement", async () => {
    const recoveryDir = path.join(tempRoot, "services")
    const recoveryPath = path.join(recoveryDir, "laya-replacement.json")
    await mkdir(recoveryDir, { recursive: true })
    await writeFile(
      recoveryPath,
      `${JSON.stringify({ schemaVersion: 1, wasRunning: true })}\n`
    )
    const containers = new Map<string, TestContainer>([
      [
        "olc-laya-rollback",
        { state: "exited", labels: "true|laya|8086|0.13.0" }
      ]
    ])
    const calls: string[][] = []
    mockDocker(async (args) => {
      calls.push(args)
      return layaReplacementDocker(args, containers)
    })

    await runManagedService("laya", "status", undefined, false, servicesRoot)

    expect(containers.get("olc-laya")?.state).toBe("running")
    expect(containers.has("olc-laya-rollback")).toBe(false)
    expect(calls.some((args) => args[0] === "start")).toBe(true)
    expect(fetch).toHaveBeenCalled()
    await expect(readFile(recoveryPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    })
  })

  it("keeps a previously stopped Laya server stopped during status recovery", async () => {
    const recoveryDir = path.join(tempRoot, "services")
    await mkdir(recoveryDir, { recursive: true })
    await writeFile(
      path.join(recoveryDir, "laya-replacement.json"),
      `${JSON.stringify({ schemaVersion: 1, wasRunning: false })}\n`
    )
    const containers = new Map<string, TestContainer>([
      [
        "olc-laya-rollback",
        { state: "exited", labels: "true|laya|8086|0.13.0" }
      ]
    ])
    const calls: string[][] = []
    mockDocker(async (args) => {
      calls.push(args)
      return layaReplacementDocker(args, containers)
    })

    await runManagedService("laya", "status", undefined, false, servicesRoot)

    expect(containers.get("olc-laya")?.state).toBe("exited")
    expect(calls.some((args) => args[0] === "start")).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe("olc list", () => {
  it("lists olc-started backends when Docker is unavailable", async () => {
    mockDocker(async (args) => {
      if (args[0] === "info") throw dockerError("Docker daemon unavailable")
      return basicDocker(args)
    })
    await registerManagedProcess({
      service: "opencode",
      url: "http://127.0.0.1:8084",
      pid: process.pid
    })
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)

    await listManagedServers(true)

    const output = JSON.parse(String(log.mock.calls.at(-1)?.[0]))
    expect(output.servers).toContainEqual(
      expect.objectContaining({
        service: "opencode",
        url: "http://127.0.0.1:8084",
        status: "running",
        health: "unknown",
        pid: process.pid
      })
    )
    expect(output.warnings).toEqual([
      expect.stringContaining("Docker services could not be checked")
    ])
    expect(error).not.toHaveBeenCalled()
  })

  it("returns local backends when Docker discovery stalls", async () => {
    await registerManagedProcess({
      service: "ollama",
      url: "http://127.0.0.1:11434",
      pid: process.pid
    })
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
    let notifyListenerRead: () => void = () => undefined
    const listenerRead = new Promise<void>((resolve) => {
      notifyListenerRead = resolve
    })
    listenersMock.mockImplementation(async () => {
      notifyListenerRead()
      return [
        {
          pid: process.pid,
          identity: "test-process-identity",
          host: "127.0.0.1",
          executable: "olc",
          uid: 0
        }
      ]
    })
    processIdentityMock.mockImplementation(async () => {
      notifyListenerRead()
      return {
        pid: process.pid,
        identity: "test-process-identity",
        executable: "olc",
        uid: 0
      }
    })
    mockDocker(async () => new Promise(() => undefined))
    vi.useFakeTimers()
    try {
      const listing = listManagedServers(true)
      await listenerRead
      await vi.advanceTimersByTimeAsync(5_000)
      await listing

      const output = JSON.parse(String(log.mock.calls.at(-1)?.[0]))
      expect(output.servers).toContainEqual(
        expect.objectContaining({
          service: "ollama",
          url: "http://127.0.0.1:11434",
          status: "running",
          pid: process.pid
        })
      )
      expect(output.warnings).toEqual([
        expect.stringContaining("within 5 seconds")
      ])
    } finally {
      vi.useRealTimers()
    }
  })
})
