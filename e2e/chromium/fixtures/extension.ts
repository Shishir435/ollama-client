import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync
} from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import {
  type BrowserContext,
  test as base,
  chromium,
  type TestInfo,
  type Worker
} from "@playwright/test"

const findFileRecursive = (directory: string, targetName: string): string => {
  for (const entry of readdirSync(directory)) {
    const fullPath = resolve(directory, entry)
    const stats = statSync(fullPath)
    if (stats.isFile() && entry === targetName) return fullPath
    if (stats.isDirectory()) {
      const found = findFileRecursive(fullPath, targetName)
      if (found) return found
    }
  }
  return ""
}

const findExtensionIdInPreferences = (
  userDataDir: string,
  extensionBuildPath: string
): string => {
  for (const fileName of ["Preferences", "Secure Preferences"]) {
    const preferencesPath = findFileRecursive(userDataDir, fileName)
    if (!preferencesPath) continue

    const preferences = JSON.parse(readFileSync(preferencesPath, "utf8")) as {
      extensions?: {
        settings?: Record<string, { path?: string }>
      }
    }
    for (const [id, value] of Object.entries(
      preferences.extensions?.settings ?? {}
    )) {
      if (value.path && resolve(value.path) === extensionBuildPath) return id
    }
  }
  return ""
}

const resolveExtensionId = async (
  context: BrowserContext,
  userDataDir: string,
  extensionBuildPath: string
): Promise<string> => {
  let serviceWorker: Worker | undefined = context.serviceWorkers()[0]
  if (!serviceWorker) {
    serviceWorker = await context
      .waitForEvent("serviceworker", { timeout: 15_000 })
      .catch(() => undefined)
  }
  if (serviceWorker) return new URL(serviceWorker.url()).host

  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const extensionId = findExtensionIdInPreferences(
      userDataDir,
      extensionBuildPath
    )
    if (extensionId) return extensionId
    await new Promise((resolvePause) => setTimeout(resolvePause, 250))
  }
  throw new Error("Failed to resolve Chromium extension id")
}

const attachRuntimeLogs = (
  context: BrowserContext,
  logs: string[]
): (() => void) => {
  const observePage = (page: import("@playwright/test").Page): void => {
    page.on("console", (message) => {
      logs.push(`[page:${message.type()}] ${message.text()}`)
    })
    page.on("pageerror", (error) => {
      logs.push(`[page:error] ${error.stack ?? error.message}`)
    })
  }
  const observeWorker = (worker: import("@playwright/test").Worker): void => {
    worker.on("console", (message) => {
      logs.push(`[worker:${message.type()}] ${message.text()}`)
    })
  }

  for (const page of context.pages()) observePage(page)
  for (const worker of context.serviceWorkers()) observeWorker(worker)
  context.on("page", observePage)
  context.on("serviceworker", observeWorker)

  return () => {
    context.off("page", observePage)
    context.off("serviceworker", observeWorker)
  }
}

export interface ExtensionSession {
  buildPath: string
  context: BrowserContext
  extensionId: string
  userDataDir: string
  restart: () => Promise<void>
}

const extensionBuildPathFor = (testInfo: TestInfo): string => {
  const configured = testInfo.project.metadata.extensionBuildPath
  if (typeof configured !== "string" || configured.length === 0) {
    throw new Error(
      `Project ${testInfo.project.name} is missing metadata.extensionBuildPath`
    )
  }
  const buildPath = resolve(configured)
  if (!existsSync(resolve(buildPath, "manifest.json"))) {
    throw new Error(
      `Missing extension build at ${buildPath}. Run: pnpm e2e:build`
    )
  }
  return buildPath
}

const createExtensionSession = async (
  testInfo: TestInfo
): Promise<{
  session: ExtensionSession
  close: () => Promise<void>
  logs: string[]
}> => {
  const buildPath = extensionBuildPathFor(testInfo)
  const userDataDir = mkdtempSync(`${tmpdir()}/ollama-client-e2e-`)
  const logs: string[] = []
  let context: BrowserContext
  let detachLogs: () => void = () => {}

  const launch = async (): Promise<BrowserContext> => {
    const launched = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: process.env.E2E_HEADFUL !== "1",
      args: [
        `--disable-extensions-except=${buildPath}`,
        `--load-extension=${buildPath}`
      ]
    })
    detachLogs = attachRuntimeLogs(launched, logs)
    return launched
  }

  context = await launch()
  const extensionId = await resolveExtensionId(context, userDataDir, buildPath)
  const session: ExtensionSession = {
    buildPath,
    context,
    extensionId,
    userDataDir,
    restart: async () => {
      detachLogs()
      await context.close()
      context = await launch()
      const restartedId = await resolveExtensionId(
        context,
        userDataDir,
        buildPath
      )
      if (restartedId !== session.extensionId) {
        throw new Error(
          `Extension id changed across restart: ${session.extensionId} -> ${restartedId}`
        )
      }
      session.context = context
    }
  }

  return {
    session,
    logs,
    close: async () => {
      detachLogs()
      await context.close().catch(() => {})
      rmSync(userDataDir, { recursive: true, force: true })
    }
  }
}

export const test = base.extend<{ extension: ExtensionSession }>({
  extension: async ({ browserName: _browserName }, use, testInfo) => {
    const runtime = await createExtensionSession(testInfo)
    try {
      await use(runtime.session)
    } finally {
      if (runtime.logs.length > 0) {
        await testInfo.attach("extension-runtime.log", {
          body: Buffer.from(`${runtime.logs.join("\n")}\n`),
          contentType: "text/plain"
        })
      }
      await runtime.close()
    }
  }
})

export { expect } from "@playwright/test"
