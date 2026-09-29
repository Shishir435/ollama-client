/** Local Docker services that olc owns and can safely start or stop. */
import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import {
  mkdir,
  readdir,
  readFile,
  rm as removeFiles,
  rmdir,
  writeFile
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import type { ServiceAction } from "./cli-options.js"
import { OLC_VERSION } from "./version.js"

const execFileAsync = promisify(execFile)
const MANAGED_LABEL = "io.ollama-client.olc.managed"
const SERVICE_LABEL = "io.ollama-client.olc.service"
const COMPONENT_LABEL = "io.ollama-client.olc.component"
const VERSION_LABEL = "io.ollama-client.olc.version"
const PORT_LABEL = "io.ollama-client.olc.port"
const LAYA_CONTAINER = "olc-laya"
const LAYA_ROLLBACK_CONTAINER = "olc-laya-rollback"
const LAYA_IMAGE = `ollama-client/laya:${OLC_VERSION}`
const LAYA_DEFAULT_PORT = 8086
const SEARXNG_DEFAULT_PORT = 8080
const SEARXNG_PROJECT = "olc-searxng"
const SEARXNG_OWNERSHIP_FILE = ".olc-managed.json"
const DOCKER_TIMEOUT_MS = 10 * 60 * 1000

type ManagedService = "laya" | "searxng"

interface DockerOptions {
  cwd?: string
  timeout?: number
}

interface DockerCommandResult {
  stdout: string
  stderr: string
}

export interface ManagedServer {
  service: ManagedService
  url: string
  status: string
  olcVersion: string
  health: "healthy" | "unhealthy"
}

/** Execute Docker without a shell; all user values travel as individual argv items. */
async function docker(
  args: string[],
  options: DockerOptions = {}
): Promise<DockerCommandResult> {
  try {
    const result = await execFileAsync("docker", args, {
      cwd: options.cwd,
      encoding: "utf8",
      timeout: options.timeout ?? 30_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true
    })
    return { stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      stderr?: string
    }
    const detail = failure.stderr?.trim() || failure.message
    throw new Error(`docker ${args[0]} failed: ${detail}`)
  }
}

async function requireDocker(compose = false): Promise<void> {
  try {
    await docker(["info", "--format", "{{.ServerVersion}}"])
  } catch (error) {
    const message = (error as Error).message
    if (message.includes("ENOENT") || message.includes("not found"))
      throw new Error(
        "Docker is required for olc-managed services. Install Docker Desktop or Docker Engine, then retry."
      )
    throw new Error(
      "Docker is installed but its daemon is unavailable. Start Docker Desktop or Docker Engine, then retry."
    )
  }
  if (compose) {
    try {
      await docker(["compose", "version"])
    } catch {
      throw new Error(
        "SearXNG requires Docker Compose v2. Install the Docker Compose plugin, then retry."
      )
    }
  }
}

function serviceDataRoot(): string {
  return path.join(
    process.env.OLC_DATA_DIR || path.join(os.homedir(), ".olc"),
    "services"
  )
}

function serviceUrl(_service: ManagedService, port: number): string {
  return `http://127.0.0.1:${port}`
}

function explainPortConflict(
  service: ManagedService,
  port: number,
  error: unknown
): Error {
  const failure = error instanceof Error ? error : new Error("Docker failed")
  if (
    /port is already allocated|address already in use|bind failed/i.test(
      failure.message
    )
  )
    return new Error(
      `Port ${port} is already in use. Start ${service} on a free loopback port with \`olc -b ${service} --port <port>\`.`
    )
  return failure
}

function servicePort(
  service: ManagedService,
  requested?: string | number
): number {
  const port = Number(
    requested ?? (service === "laya" ? LAYA_DEFAULT_PORT : SEARXNG_DEFAULT_PORT)
  )
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Service ports must be integers between 1024 and 65535.")
  return port
}

async function containerLabels(name: string): Promise<string[] | undefined> {
  try {
    const result = await docker([
      "inspect",
      "--format",
      `{{index .Config.Labels "${MANAGED_LABEL}"}}|{{index .Config.Labels "${SERVICE_LABEL}"}}|{{index .Config.Labels "${PORT_LABEL}"}}|{{index .Config.Labels "${VERSION_LABEL}"}}`,
      name
    ])
    return result.stdout.trim().split("|")
  } catch (error) {
    if (/No such object|No such container/i.test((error as Error).message))
      return undefined
    throw error
  }
}

async function containerState(name: string): Promise<string | undefined> {
  try {
    const result = await docker([
      "inspect",
      "--format",
      "{{.State.Status}}",
      name
    ])
    return result.stdout.trim()
  } catch (error) {
    if (/No such object|No such container/i.test((error as Error).message))
      return undefined
    throw error
  }
}

async function imageExists(image: string): Promise<boolean> {
  try {
    await docker(["image", "inspect", image])
    return true
  } catch {
    return false
  }
}

async function ensureLayaImage(servicesRoot: string): Promise<void> {
  if (await imageExists(LAYA_IMAGE)) return
  const context = path.join(servicesRoot, "laya")
  console.log(
    `Building the Laya server image ${LAYA_IMAGE} (first run only)...`
  )
  await docker(["build", "--tag", LAYA_IMAGE, context], {
    timeout: DOCKER_TIMEOUT_MS
  })
}

async function waitForHttp(
  url: string,
  pathName: string,
  timeoutMs = 90_000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}${pathName}`, {
        redirect: "error",
        signal: AbortSignal.timeout(1500)
      })
      if (response.ok) {
        await response.body?.cancel()
        return true
      }
      await response.body?.cancel()
    } catch {
      // The service has not bound its port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

async function layaAction(
  action: ServiceAction,
  requestedPort: string | number | undefined,
  purgeData: boolean,
  servicesRoot: string
): Promise<void> {
  await requireDocker()
  await recoverLayaReplacement()
  const state = await containerState(LAYA_CONTAINER)
  const labels =
    state === undefined ? undefined : await containerLabels(LAYA_CONTAINER)
  assertLayaOwnership(labels)
  const configuredPort = labels?.[2] ? Number(labels[2]) : undefined
  const replacingVersion =
    action === "start" && state !== undefined && labels?.[3] !== OLC_VERSION
  const port =
    requestedPort === undefined
      ? (configuredPort ?? LAYA_DEFAULT_PORT)
      : servicePort("laya", requestedPort)
  if (replacingVersion && state !== undefined) {
    assertLayaPort(action, state, configuredPort, port)
    await replaceLayaContainer(
      state,
      configuredPort ?? LAYA_DEFAULT_PORT,
      port,
      servicesRoot
    )
    return
  }
  assertLayaPort(action, state, configuredPort, port)
  const url = serviceUrl("laya", port)

  if (action === "status") {
    await showLayaStatus(state, url)
    return
  }

  if (action === "stop") {
    await stopLaya(state)
    return
  }

  if (action === "rm") {
    await removeLaya(state, purgeData)
    return
  }

  await startLaya(state, port, servicesRoot)
  await waitForLaya(url)
}

function assertLayaOwnership(
  labels: string[] | undefined,
  name = LAYA_CONTAINER
): void {
  if (labels && (labels[0] !== "true" || labels[1] !== "laya"))
    throw new Error(
      `Container ${name} exists but is not an olc-managed Laya server; it was left untouched.`
    )
}

async function recoverLayaReplacement(): Promise<void> {
  const rollbackState = await containerState(LAYA_ROLLBACK_CONTAINER)
  if (rollbackState === undefined) return
  const rollbackLabels = await containerLabels(LAYA_ROLLBACK_CONTAINER)
  assertLayaOwnership(rollbackLabels, LAYA_ROLLBACK_CONTAINER)

  const currentState = await containerState(LAYA_CONTAINER)
  if (currentState === undefined) {
    await docker(["rename", LAYA_ROLLBACK_CONTAINER, LAYA_CONTAINER])
    if (rollbackState !== "running") await docker(["start", LAYA_CONTAINER])
    return
  }

  const currentLabels = await containerLabels(LAYA_CONTAINER)
  assertLayaOwnership(currentLabels)
  const currentPort = Number(currentLabels?.[2]) || LAYA_DEFAULT_PORT
  if (
    currentState === "running" &&
    currentLabels?.[3] === OLC_VERSION &&
    (await waitForHttp(serviceUrl("laya", currentPort), "/health", 10_000))
  ) {
    await docker(["rm", "--force", LAYA_ROLLBACK_CONTAINER])
    return
  }

  await restoreLayaContainer()
}

async function restoreLayaContainer(shouldRun = true): Promise<void> {
  const replacementState = await containerState(LAYA_CONTAINER)
  if (replacementState !== undefined) {
    assertLayaOwnership(await containerLabels(LAYA_CONTAINER))
    await docker(["rm", "--force", LAYA_CONTAINER])
  }
  await docker(["rename", LAYA_ROLLBACK_CONTAINER, LAYA_CONTAINER])
  const restoredState = await containerState(LAYA_CONTAINER)
  if (shouldRun && restoredState !== "running")
    await docker(["start", LAYA_CONTAINER])
  else if (!shouldRun && restoredState === "running")
    await docker(["stop", LAYA_CONTAINER])
  const labels = await containerLabels(LAYA_CONTAINER)
  assertLayaOwnership(labels)
  if (shouldRun) {
    const port = Number(labels?.[2]) || LAYA_DEFAULT_PORT
    await waitForLaya(serviceUrl("laya", port))
  }
}

async function replaceLayaContainer(
  oldState: string,
  oldPort: number,
  newPort: number,
  servicesRoot: string
): Promise<void> {
  // Build while the old server remains live, so build/network failures do not
  // take down a working service.
  await ensureLayaImage(servicesRoot)
  if ((await containerState(LAYA_ROLLBACK_CONTAINER)) !== undefined)
    throw new Error(
      `A previous Laya replacement is still pending in ${LAYA_ROLLBACK_CONTAINER}; retry olc -b laya to recover it first.`
    )

  let moved = false
  try {
    if (oldState === "running") await docker(["stop", LAYA_CONTAINER])
    await docker(["rename", LAYA_CONTAINER, LAYA_ROLLBACK_CONTAINER])
    moved = true
    await startLaya(undefined, newPort, servicesRoot)
    await waitForLaya(serviceUrl("laya", newPort))
  } catch (error) {
    const backupExists =
      (await containerState(LAYA_ROLLBACK_CONTAINER)) !== undefined
    if (!moved && !backupExists) {
      const retainedState = await containerState(LAYA_CONTAINER)
      if (oldState === "running" && retainedState !== "running")
        await docker(["start", LAYA_CONTAINER])
      throw new Error(
        `Laya update failed before replacing the existing server; it was retained. ${(error as Error).message}`
      )
    }
    try {
      await restoreLayaContainer(oldState === "running")
    } catch (restoreError) {
      throw new Error(
        `Laya update failed: ${(error as Error).message}. Automatic rollback also failed: ${(restoreError as Error).message}. The previous container is still named ${LAYA_ROLLBACK_CONTAINER}.`
      )
    }
    throw new Error(
      `Laya update failed; the previous server was restored at ${serviceUrl("laya", oldPort)}. ${(error as Error).message}`
    )
  }
  await docker(["rm", "--force", LAYA_ROLLBACK_CONTAINER])
}

function assertLayaPort(
  action: ServiceAction,
  state: string | undefined,
  configuredPort: number | undefined,
  requestedPort: number
): void {
  if (
    state !== undefined &&
    configuredPort &&
    configuredPort !== requestedPort &&
    action === "start"
  )
    throw new Error(
      `Laya is already configured for port ${configuredPort}. Stop and remove that container before changing ports.`
    )
}

async function showLayaStatus(
  state: string | undefined,
  url: string
): Promise<void> {
  if (state === undefined) {
    console.log("Laya is not running. Start it with `olc -b laya`.")
    return
  }
  const healthy =
    state === "running" && (await waitForHttp(url, "/health", 10_000))
  console.log(`Laya ${healthy ? "ready" : state}: ${url}/v1/systemone`)
  if (state === "running" && !healthy) process.exitCode = 1
}

async function stopLaya(state: string | undefined): Promise<void> {
  if (state === undefined) {
    console.log("Laya is not running.")
    return
  }
  await docker(["stop", LAYA_CONTAINER])
  console.log("Stopped Laya. Its downloaded model cache is preserved.")
}

async function removeLaya(
  state: string | undefined,
  purgeData: boolean
): Promise<void> {
  if (state !== undefined) await docker(["rm", "--force", LAYA_CONTAINER])
  if (purgeData) {
    await docker(["volume", "rm", "olc-laya-model-cache"]).catch((error) => {
      if (!/no such volume/i.test((error as Error).message)) throw error
    })
    console.log("Removed Laya and its downloaded model cache.")
  } else {
    console.log(
      "Removed the Laya container. Its downloaded model cache is preserved."
    )
  }
}

async function startLaya(
  state: string | undefined,
  port: number,
  servicesRoot: string
): Promise<void> {
  if (state !== undefined) {
    if (state !== "running") await docker(["start", LAYA_CONTAINER])
  } else {
    await ensureLayaImage(servicesRoot)
    await docker(["volume", "create", "olc-laya-model-cache"])
    try {
      await docker([
        "run",
        "--detach",
        "--name",
        LAYA_CONTAINER,
        "--restart",
        "unless-stopped",
        "--label",
        `${MANAGED_LABEL}=true`,
        "--label",
        `${SERVICE_LABEL}=laya`,
        "--label",
        `${COMPONENT_LABEL}=server`,
        "--label",
        `${VERSION_LABEL}=${OLC_VERSION}`,
        "--label",
        `${PORT_LABEL}=${port}`,
        "--publish",
        `127.0.0.1:${port}:8000`,
        "--mount",
        "type=volume,source=olc-laya-model-cache,target=/models",
        "--env",
        "HF_HOME=/models",
        "--env",
        "LAYA_HOST=0.0.0.0",
        "--env",
        "LAYA_PORT=8000",
        "--env",
        "LAYA_PRELOAD=0",
        "--env",
        "LAYA_DEVICE=cpu",
        LAYA_IMAGE
      ])
    } catch (error) {
      throw explainPortConflict("laya", port, error)
    }
  }
}

async function waitForLaya(url: string): Promise<void> {
  if (!(await waitForHttp(url, "/health"))) {
    const logs = await docker(["logs", "--tail", "40", LAYA_CONTAINER]).catch(
      (error) => ({ stdout: "", stderr: (error as Error).message })
    )
    const detail = logs.stderr.trim() || logs.stdout.trim()
    throw new Error(
      `Laya container did not become healthy at ${url}.${detail ? ` Container output: ${detail}` : ""}`
    )
  }
  console.log(`Laya is ready at ${url}/v1/systemone`)
}

async function readOrCreate(
  filePath: string,
  create: () => Promise<string>
): Promise<string> {
  try {
    return await readFile(filePath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    const contents = await create()
    await writeFile(filePath, contents, { mode: 0o600, flag: "wx" }).catch(
      async (writeError) => {
        if ((writeError as NodeJS.ErrnoException).code !== "EEXIST")
          throw writeError
      }
    )
    return readFile(filePath, "utf8")
  }
}

async function updateEnvFile(
  filePath: string,
  requestedPort?: number
): Promise<number> {
  const current = await readOrCreate(filePath, async () => "")
  const existingPort = Number(
    current.match(/^SEARXNG_HOST_PORT=(\d+)\s*$/m)?.[1] ?? SEARXNG_DEFAULT_PORT
  )
  const port = servicePort("searxng", requestedPort ?? existingPort)
  const lines = current.split(/\r?\n/).filter((line) => line.length > 0)
  const set = (key: string, value: string) => {
    const index = lines.findIndex((line) => line.startsWith(`${key}=`))
    if (index < 0) lines.push(`${key}=${value}`)
    else lines[index] = `${key}=${value}`
  }
  if (!/^SEARXNG_VERSION=/m.test(current)) set("SEARXNG_VERSION", "latest")
  if (requestedPort !== undefined || !/^SEARXNG_HOST_PORT=/m.test(current))
    set("SEARXNG_HOST_PORT", String(port))
  set("OLC_VERSION", OLC_VERSION)
  await writeFile(filePath, `${lines.join("\n")}\n`, { mode: 0o600 })
  return port
}

function unownedSearxngDirectory(): Error {
  return new Error(
    "SearXNG data directory is not recognized as olc-managed; it was left untouched."
  )
}

async function readOptionalFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

async function writeSearxngOwnership(dataDir: string): Promise<void> {
  const markerPath = path.join(dataDir, SEARXNG_OWNERSHIP_FILE)
  const marker = JSON.stringify({ schemaVersion: 1, service: "searxng" })
  try {
    await writeFile(markerPath, `${marker}\n`, {
      mode: 0o600,
      flag: "wx"
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
  }
  const savedMarker = await readFile(markerPath, "utf8")
  if (savedMarker !== `${marker}\n`) throw unownedSearxngDirectory()
}

/** Verify the project before any Compose command can inspect or remove it. */
async function ensureSearxngOwnership(
  dataDir: string,
  assetsRoot: string,
  allowCreate: boolean
): Promise<boolean> {
  if (allowCreate) await mkdir(dataDir, { recursive: true, mode: 0o700 })
  const markerPath = path.join(dataDir, SEARXNG_OWNERSHIP_FILE)
  const marker = await readOptionalFile(markerPath)
  const composePath = path.join(dataDir, "docker-compose.yml")
  const compose = await readOptionalFile(composePath)
  const bundledCompose = await readFile(
    path.join(assetsRoot, "searxng", "docker-compose.yml"),
    "utf8"
  )

  if (marker !== undefined) {
    if (
      marker !== `${JSON.stringify({ schemaVersion: 1, service: "searxng" })}\n`
    )
      throw unownedSearxngDirectory()
    if (compose !== undefined && compose !== bundledCompose)
      throw unownedSearxngDirectory()
    if (compose === undefined && !allowCreate) return false
    return true
  }

  if (compose !== undefined) {
    const env = await readOptionalFile(path.join(dataDir, ".env"))
    const settings = await readOptionalFile(
      path.join(dataDir, "core-config", "settings.yml")
    )
    const generatedByOlderOlc =
      compose === bundledCompose &&
      env?.includes("OLC_VERSION=") === true &&
      settings?.includes("secret_key:") === true &&
      !settings.includes("__SECRET_KEY__")
    if (!generatedByOlderOlc) throw unownedSearxngDirectory()
    await writeSearxngOwnership(dataDir)
    return true
  }

  if (!allowCreate) return false
  const entries = await readdir(dataDir)
  if (entries.length > 0) throw unownedSearxngDirectory()
  await writeSearxngOwnership(dataDir)
  return true
}

async function ensureSearxngFiles(
  dataDir: string,
  assetsRoot: string,
  requestedPort?: number
): Promise<number> {
  await ensureSearxngOwnership(dataDir, assetsRoot, true)
  const coreConfig = path.join(dataDir, "core-config")
  await mkdir(coreConfig, { recursive: true, mode: 0o700 })
  const composePath = path.join(dataDir, "docker-compose.yml")
  await readOrCreate(composePath, () =>
    readFile(path.join(assetsRoot, "searxng", "docker-compose.yml"), "utf8")
  )
  const envPath = path.join(dataDir, ".env")
  const port = await updateEnvFile(envPath, requestedPort)
  const settingsPath = path.join(coreConfig, "settings.yml")
  const settings = await readOrCreate(settingsPath, async () => {
    const template = await readFile(
      path.join(assetsRoot, "searxng", "settings.yml.template"),
      "utf8"
    )
    return template
      .replaceAll("__HOST_PORT__", String(port))
      .replaceAll("__SECRET_KEY__", randomBytes(32).toString("hex"))
  })
  if (settings.includes("__SECRET_KEY__"))
    throw new Error(
      `SearXNG settings at ${settingsPath} still contain the secret-key placeholder.`
    )
  if (!settings.includes(`http://localhost:${port}/`)) {
    const updated = settings.replace(
      /^ {2}base_url: "http:\/\/localhost:\d+\/"$/m,
      `  base_url: "http://localhost:${port}/"`
    )
    if (updated !== settings)
      await writeFile(settingsPath, updated, { mode: 0o600 })
  }
  return port
}

/** Older olc-created directories used the default port and no .env file. */
async function savedSearxngPort(dataDir: string): Promise<number | null> {
  if (
    (await readOptionalFile(path.join(dataDir, "docker-compose.yml"))) ===
    undefined
  )
    return null
  const env = await readOptionalFile(path.join(dataDir, ".env"))
  // Older olc-created directories used the default port and no .env file.
  const match = env?.match(/^SEARXNG_HOST_PORT=(\d+)\s*$/m)
  return servicePort("searxng", match?.[1] ?? SEARXNG_DEFAULT_PORT)
}

async function stopSearxng(
  dataDir: string,
  composeArgs: string[]
): Promise<void> {
  await docker([...composeArgs, "stop"], { cwd: dataDir })
  console.log(
    "Stopped SearXNG. Its containers, config, and data are preserved."
  )
}

async function removeSearxng(
  dataDir: string,
  composeArgs: string[],
  purgeData: boolean
): Promise<void> {
  await docker([...composeArgs, "down", ...(purgeData ? ["--volumes"] : [])], {
    cwd: dataDir
  })
  if (purgeData) {
    await removeOwnedSearxngFiles(dataDir)
    console.log("Removed SearXNG, its local config, and search data volumes.")
  } else {
    console.log(
      "Removed SearXNG containers. Its config and data volumes are preserved."
    )
  }
}

async function removeOwnedSearxngFiles(dataDir: string): Promise<void> {
  const coreConfig = path.join(dataDir, "core-config")
  const ownedFiles = [
    path.join(dataDir, SEARXNG_OWNERSHIP_FILE),
    path.join(dataDir, "docker-compose.yml"),
    path.join(dataDir, ".env"),
    path.join(coreConfig, "settings.yml")
  ]
  for (const filePath of ownedFiles)
    await removeFiles(filePath, { force: true })
  await removeEmptyDirectory(coreConfig)
  await removeEmptyDirectory(dataDir)
}

async function removeEmptyDirectory(directory: string): Promise<void> {
  try {
    await rmdir(directory)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== "ENOENT" && code !== "ENOTEMPTY" && code !== "EEXIST")
      throw error
  }
}

async function showSearxngStatus(
  dataDir: string,
  composeArgs: string[],
  port: number
): Promise<void> {
  const result = await docker(
    [...composeArgs, "ps", "--status", "running", "--services"],
    { cwd: dataDir }
  )
  if (!result.stdout.trim()) {
    console.log("SearXNG is not running. Start it with `olc -b searxng`.")
    return
  }
  const url = serviceUrl("searxng", port)
  const healthy = await waitForHttp(url, "/", 1000)
  console.log(`SearXNG ${healthy ? "ready" : "starting"}: ${url}`)
  if (!healthy) process.exitCode = 1
}

interface SavedFile {
  path: string
  contents: string | undefined
}

async function snapshotSearxngConfig(dataDir: string): Promise<SavedFile[]> {
  const paths = [
    path.join(dataDir, ".env"),
    path.join(dataDir, "core-config", "settings.yml")
  ]
  return Promise.all(
    paths.map(async (filePath) => ({
      path: filePath,
      contents: await readOptionalFile(filePath)
    }))
  )
}

async function restoreSearxngConfig(files: SavedFile[]): Promise<void> {
  for (const file of files) {
    if (file.contents === undefined)
      await removeFiles(file.path, { force: true })
    else await writeFile(file.path, file.contents, { mode: 0o600 })
  }
}

async function searxngAction(
  action: ServiceAction,
  requestedPort: string | number | undefined,
  purgeData: boolean,
  servicesRoot: string
): Promise<void> {
  const dataDir = path.join(serviceDataRoot(), "searxng")
  const owned = await ensureSearxngOwnership(
    dataDir,
    servicesRoot,
    action === "start"
  )
  if (!owned) {
    console.log("SearXNG is not running. Start it with `olc -b searxng`.")
    return
  }
  await requireDocker(true)
  const savedPort = await savedSearxngPort(dataDir)
  const port = servicePort(
    "searxng",
    action === "start"
      ? (requestedPort ?? savedPort ?? undefined)
      : (savedPort ?? requestedPort ?? undefined)
  )
  const composeArgs = [
    "compose",
    "--project-name",
    SEARXNG_PROJECT,
    "--file",
    "docker-compose.yml"
  ]
  if (action === "stop") {
    await stopSearxng(dataDir, composeArgs)
    return
  }
  if (action === "rm") {
    await removeSearxng(dataDir, composeArgs, purgeData)
    return
  }
  if (action === "status") {
    await showSearxngStatus(dataDir, composeArgs, port)
    return
  }

  await startSearxng(
    dataDir,
    servicesRoot,
    composeArgs,
    port,
    requestedPort,
    savedPort ?? undefined
  )
}

async function startSearxng(
  dataDir: string,
  servicesRoot: string,
  composeArgs: string[],
  port: number,
  requestedPort: string | number | undefined,
  savedPort: number | null | undefined
): Promise<void> {
  const changingPort = savedPort != null && port !== savedPort
  const previousFiles = changingPort
    ? await snapshotSearxngConfig(dataDir)
    : undefined
  const url = serviceUrl("searxng", port)
  const previousServicesRunning = changingPort
    ? await searxngIsRunning(dataDir, composeArgs)
    : false

  try {
    await ensureSearxngFiles(
      dataDir,
      servicesRoot,
      requestedPort === undefined ? undefined : port
    )
    const result = await docker([...composeArgs, "up", "-d"], {
      cwd: dataDir,
      timeout: DOCKER_TIMEOUT_MS
    })
    if (!(await waitForHttp(url, "/", 90_000)))
      throw new Error(
        `SearXNG did not become ready at ${url}.${result.stderr.trim() ? ` ${result.stderr.trim()}` : ""}`
      )
  } catch (error) {
    if (changingPort && previousFiles)
      await rollbackSearxngPortChange(
        dataDir,
        composeArgs,
        previousFiles,
        previousServicesRunning,
        error
      )
    throw explainPortConflict("searxng", port, error)
  }
  console.log(`SearXNG is ready at ${url}`)
}

async function searxngIsRunning(
  dataDir: string,
  composeArgs: string[]
): Promise<boolean> {
  const result = await docker(
    [...composeArgs, "ps", "--status", "running", "--services"],
    { cwd: dataDir }
  )
  return result.stdout.trim().length > 0
}

async function rollbackSearxngPortChange(
  dataDir: string,
  composeArgs: string[],
  previousFiles: SavedFile[],
  previousServicesRunning: boolean,
  cause: unknown
): Promise<void> {
  try {
    await restoreSearxngConfig(previousFiles)
    await docker(
      [
        ...composeArgs,
        previousServicesRunning ? "up" : "stop",
        ...(previousServicesRunning ? ["-d"] : [])
      ],
      { cwd: dataDir, timeout: DOCKER_TIMEOUT_MS }
    )
  } catch (rollbackError) {
    throw new Error(
      `SearXNG port change failed: ${(cause as Error).message}. Automatic rollback could not restore the previous config and service state: ${(rollbackError as Error).message}`
    )
  }
}

/** Start, stop, or inspect one olc-managed Docker service. */
export async function runManagedService(
  service: ManagedService,
  action: ServiceAction,
  requestedPort: string | number | undefined,
  purgeData: boolean,
  servicesRoot: string
): Promise<void> {
  if (service === "laya")
    return layaAction(action, requestedPort, purgeData, servicesRoot)
  return searxngAction(action, requestedPort, purgeData, servicesRoot)
}

/** List only running service containers carrying olc's ownership labels. */
export async function listManagedServers(json = false): Promise<void> {
  await requireDocker()
  const result = await docker([
    "ps",
    "--filter",
    `label=${MANAGED_LABEL}=true`,
    "--filter",
    "status=running",
    "--format",
    `{{.Label "${SERVICE_LABEL}"}}|{{.Label "${COMPONENT_LABEL}"}}|{{.Label "${PORT_LABEL}"}}|{{.Label "${VERSION_LABEL}"}}|{{.Status}}`
  ])
  const grouped = new Map<
    ManagedService,
    { port: number; status: string; olcVersion: string }
  >()
  for (const row of result.stdout.split(/\r?\n/)) {
    const [rawService, component, rawPort, olcVersion, status] = row.split("|")
    if (
      (rawService !== "laya" && rawService !== "searxng") ||
      component !== "server" ||
      !rawPort
    )
      continue
    grouped.set(rawService, {
      port: Number(rawPort),
      olcVersion: olcVersion || "unknown",
      status: status || "running"
    })
  }
  const servers: ManagedServer[] = []
  for (const [service, entry] of grouped) {
    const url = serviceUrl(service, entry.port)
    const pathName = service === "laya" ? "/health" : "/"
    const healthy = await waitForHttp(
      url,
      pathName,
      service === "laya" ? 10_000 : 1000
    )
    servers.push({
      service,
      url,
      status: entry.status,
      olcVersion: entry.olcVersion,
      health: healthy ? "healthy" : "unhealthy"
    })
  }
  if (json) {
    console.log(JSON.stringify({ servers }, null, 2))
    return
  }
  if (servers.length === 0) {
    console.log("No running Docker servers managed by olc.")
    return
  }
  console.log(
    "SERVICE  URL                       STATUS       HEALTH    OLC VERSION"
  )
  for (const server of servers)
    console.log(
      `${server.service.padEnd(8)} ${server.url.padEnd(25)} ${server.status.padEnd(12)} ${server.health.padEnd(9)} ${server.olcVersion}`
    )
}
