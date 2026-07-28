import {
  existsSync,
  mkdirSync,
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
  type Page,
  type TestInfo,
  type Video,
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
  artifactPaths: {
    screenshots: string[]
    traces: string[]
    videos: string[]
  }
  captureFailureScreenshots: () => Promise<void>
  session: ExtensionSession
  close: () => Promise<void>
  logs: string[]
}> => {
  const buildPath = extensionBuildPathFor(testInfo)
  const userDataDir = mkdtempSync(`${tmpdir()}/ollama-client-e2e-`)
  const artifactDir = testInfo.outputPath("persistent-context")
  const videoDir = resolve(artifactDir, "videos")
  mkdirSync(videoDir, { recursive: true })
  const logs: string[] = []
  const screenshots: string[] = []
  const traces: string[] = []
  const videos: string[] = []
  const pendingVideos = new Set<Video>()
  let context: BrowserContext
  let detachLogs: () => void = () => {}
  let launchNumber = 0
  let tracePath = ""

  const launch = async (): Promise<BrowserContext> => {
    launchNumber += 1
    const launched = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: process.env.E2E_HEADFUL !== "1",
      viewport: { width: 1280, height: 720 },
      recordVideo: {
        dir: videoDir,
        size: { width: 1280, height: 720 }
      },
      args: [
        `--disable-extensions-except=${buildPath}`,
        `--load-extension=${buildPath}`
      ]
    })
    const trackVideo = (page: Page): void => {
      const video = page.video()
      if (video) pendingVideos.add(video)
    }
    for (const page of launched.pages()) trackVideo(page)
    launched.on("page", trackVideo)
    tracePath = resolve(artifactDir, `trace-${launchNumber}.zip`)
    await launched.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: true
    })
    detachLogs = attachRuntimeLogs(launched, logs)
    return launched
  }

  const closeContext = async (): Promise<void> => {
    await context.tracing.stop({ path: tracePath }).catch(() => {})
    if (existsSync(tracePath)) traces.push(tracePath)
    detachLogs()
    await context.close().catch(() => {})
    for (const video of pendingVideos) {
      const path = await video.path().catch(() => "")
      if (path && existsSync(path) && !videos.includes(path)) videos.push(path)
    }
  }

  context = await launch()
  const extensionId = await resolveExtensionId(context, userDataDir, buildPath)
  const session: ExtensionSession = {
    buildPath,
    context,
    extensionId,
    userDataDir,
    restart: async () => {
      await closeContext()
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
    artifactPaths: { screenshots, traces, videos },
    captureFailureScreenshots: async () => {
      await Promise.all(
        context.pages().map(async (page, index) => {
          const screenshotPath = resolve(
            artifactDir,
            `failure-page-${index + 1}.png`
          )
          await page
            .screenshot({ path: screenshotPath, fullPage: true })
            .then(() => screenshots.push(screenshotPath))
            .catch(() => {})
        })
      )
    },
    session,
    logs,
    close: async () => {
      await closeContext()
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
      const failed = testInfo.status !== testInfo.expectedStatus
      if (failed) await runtime.captureFailureScreenshots()
      if (runtime.logs.length > 0) {
        await testInfo.attach("extension-runtime.log", {
          body: Buffer.from(`${runtime.logs.join("\n")}\n`),
          contentType: "text/plain"
        })
      }
      await runtime.close()
      if (failed) {
        for (const [kind, paths, contentType] of [
          ["screenshot", runtime.artifactPaths.screenshots, "image/png"],
          ["trace", runtime.artifactPaths.traces, "application/zip"],
          ["video", runtime.artifactPaths.videos, "video/webm"]
        ] as const) {
          for (const [index, path] of paths.entries()) {
            await testInfo.attach(`persistent-context-${kind}-${index + 1}`, {
              path,
              contentType
            })
          }
        }
      } else {
        rmSync(testInfo.outputPath("persistent-context"), {
          recursive: true,
          force: true
        })
      }
    }
  }
})

export { expect } from "@playwright/test"
