import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Startup ordering (H2). Database work waits for a ready owner, data-shape
 * recovery finishes before workflow recovery reads what it rewrote, and no
 * single slow workflow monopolizes the boot.
 */

let started: string[] = []
let finished: string[] = []
let inFlight = 0
let peakInFlight = 0

/** A task that records when it ran and does not settle until released. */
const deferredTask = (name: string) => {
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let receivedSignal: AbortSignal | undefined
  const run = vi.fn(async (signal?: AbortSignal) => {
    receivedSignal = signal
    started.push(name)
    inFlight += 1
    peakInFlight = Math.max(peakInFlight, inFlight)
    await gate
    inFlight -= 1
    finished.push(name)
    signal?.throwIfAborted()
  })
  return {
    name,
    run,
    release: () => release(),
    signal: () => receivedSignal
  }
}

type DeferredTask = ReturnType<typeof deferredTask>

const TASK_NAMES = [
  "backup-import",
  "provider-migration",
  "embedding-migration",
  "prune-tool-loops",
  "resume-turns",
  "resume-ingestion",
  "resume-pulls"
] as const

type TaskName = (typeof TASK_NAMES)[number]

/**
 * Rebuilt per test, because a startup chain is module state a finished test
 * could still be sitting inside. Every test also drains its own chain.
 */
let tasks: Record<TaskName, DeferredTask>

const releaseAll = () => {
  for (const name of TASK_NAMES) tasks[name].release()
}

const resumePendingAppLifecycle = vi.fn(async () => undefined)
const loggerError = vi.fn()
const loggerWarn = vi.fn()
const recordDiagnosticEvent = vi.fn().mockResolvedValue(undefined)

vi.mock("@/lib/app-reset", () => ({
  resumePendingAppLifecycle: () => resumePendingAppLifecycle()
}))
vi.mock("@/lib/storage/backup-import-transaction", () => ({
  recoverBackupImport: (signal?: AbortSignal) =>
    tasks["backup-import"].run(signal)
}))
vi.mock("@/lib/storage/provider-migration", () => ({
  migrateLegacyProviderStorage: (_storage: unknown, signal?: AbortSignal) =>
    tasks["provider-migration"].run(signal)
}))
vi.mock("@/lib/migration/embedding-dimension-migration", () => ({
  runEmbeddingDimensionMigration: (signal?: AbortSignal) =>
    tasks["embedding-migration"].run(signal)
}))
vi.mock("@/lib/repositories/tool-loop-runs", () => ({
  pruneStaleToolLoopRuns: (_olderThan: unknown, signal?: AbortSignal) =>
    tasks["prune-tool-loops"].run(signal)
}))
vi.mock("@/background/durable-turn-runtime", () => ({
  resumeIncompleteTurnRuns: (signal?: AbortSignal) =>
    tasks["resume-turns"].run(signal)
}))
vi.mock("@/lib/ingestion/ingestion-service", () => ({
  IngestionService: {
    resumeIncomplete: (signal?: AbortSignal) =>
      tasks["resume-ingestion"].run(signal)
  }
}))
vi.mock("@/background/model-pull-runtime", () => ({
  ModelPullService: {
    resumeIncomplete: (signal?: AbortSignal) =>
      tasks["resume-pulls"].run(signal)
  }
}))
vi.mock("@/lib/diagnostics/diagnostic-recorder", () => ({
  recordDiagnosticEvent: (...args: unknown[]) => recordDiagnosticEvent(...args)
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    error: (...args: unknown[]) => loggerError(...args),
    warn: (...args: unknown[]) => loggerWarn(...args),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

vi.mock("@/lib/browser-api", () => ({
  browser: {
    runtime: {
      getManifest: () => ({ version: "0.13.0" }),
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      getURL: (path: string) => path,
      setUninstallURL: vi.fn().mockResolvedValue(undefined)
    },
    i18n: { getUILanguage: () => "en" },
    storage: { onChanged: { addListener: vi.fn() } },
    action: { onClicked: { addListener: vi.fn() } },
    permissions: { onAdded: { addListener: vi.fn() } },
    windows: { create: vi.fn() }
  },
  isChromiumBased: () => false
}))

vi.mock("@/background/handlers/handle-context-menu", () => ({
  initializeContextMenu: vi.fn()
}))
vi.mock("@/background/handlers/handle-embedding-download", () => ({
  downloadEmbeddingModelSilently: vi.fn()
}))
vi.mock("@/background/lib/dnr", () => ({ updateDNRRules: vi.fn() }))
vi.mock("@/background/lib/omnibox", () => ({
  registerOmniboxQuickAsk: vi.fn()
}))
vi.mock("@/background/lib/reminders", () => ({
  registerReminderAlarms: vi.fn()
}))
vi.mock("@/background/lib/resolve-model-tools", () => ({
  clearModelToolCapabilityCache: vi.fn()
}))
vi.mock("@/background/lib/scheduled-jobs", () => ({
  registerScheduledJobs: vi.fn()
}))
vi.mock("@/lib/providers/ollama", () => ({
  clearOllamaDetailBackfillCache: vi.fn()
}))
vi.mock("@/lib/tools/build-tool-registry", () => ({
  getToolRegistry: () => ({ invalidate: vi.fn() })
}))
vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: vi.fn().mockResolvedValue(true)
}))

const settle = async () => {
  for (let tick = 0; tick < 50; tick += 1) await Promise.resolve()
}

const loadStartup = async () => {
  vi.resetModules()
  return import("../startup")
}

beforeEach(() => {
  vi.clearAllMocks()
  resumePendingAppLifecycle.mockResolvedValue(undefined)
  started = []
  finished = []
  inFlight = 0
  peakInFlight = 0
  tasks = Object.fromEntries(
    TASK_NAMES.map((name) => [name, deferredTask(name)])
  ) as Record<TaskName, DeferredTask>
})

afterEach(async () => {
  releaseAll()
  await settle()
})

describe("background database startup", () => {
  it("touches no database until the persistence owner is ready", async () => {
    let markReady: () => void = () => undefined
    const persistenceReady = new Promise<void>((resolve) => {
      markReady = resolve
    })

    const { initializeBackgroundStartup } = await loadStartup()
    initializeBackgroundStartup(persistenceReady)
    await settle()

    expect(started).toEqual([])

    markReady()
    await settle()

    expect(started).toEqual(["backup-import"])
  })

  it("finishes data-shape recovery before workflow recovery starts", async () => {
    const { initializeBackgroundStartup } = await loadStartup()
    initializeBackgroundStartup(Promise.resolve())
    await settle()

    expect(started).toEqual(["backup-import"])

    tasks["backup-import"].release()
    await settle()
    expect(started).toEqual(["backup-import", "provider-migration"])

    tasks["provider-migration"].release()
    await settle()
    expect(started).toEqual([
      "backup-import",
      "provider-migration",
      "embedding-migration"
    ])

    tasks["embedding-migration"].release()
    await settle()

    // Two workflows at a time, and only once the migrations are done.
    expect(started.slice(3)).toEqual(["prune-tool-loops", "resume-turns"])
    expect(peakInFlight).toBe(2)

    releaseAll()
    await settle()

    expect(finished).toHaveLength(TASK_NAMES.length)
    expect(peakInFlight).toBe(2)
  })

  it("aborts a timed-out schema task and waits for acknowledgment before its successor", async () => {
    vi.useFakeTimers()
    try {
      const { initializeBackgroundStartup } = await loadStartup()
      initializeBackgroundStartup(Promise.resolve())
      await settle()

      tasks["backup-import"].release()
      await settle()
      expect(started).toEqual(["backup-import", "provider-migration"])

      await vi.advanceTimersByTimeAsync(120_000)
      await settle()

      expect(tasks["provider-migration"].signal()?.aborted).toBe(true)
      expect(started).toEqual(["backup-import", "provider-migration"])
      expect(finished).not.toContain("provider-migration")
      expect(inFlight).toBe(1)

      tasks["provider-migration"].release()
      await settle()

      expect(finished).toContain("provider-migration")
      expect(started).toEqual([
        "backup-import",
        "provider-migration",
        "embedding-migration"
      ])
      expect(inFlight).toBe(1)
      expect(loggerWarn).toHaveBeenCalledWith(
        "Startup recovery timed out: provider storage migration",
        "BackgroundSW",
        expect.objectContaining({ durationMs: expect.any(Number) })
      )
      expect(recordDiagnosticEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "STARTUP_RECOVERY_TIMEOUT",
          operation: "startup.recovery.provider-migration",
          metadata: expect.objectContaining({
            status: "cancellation-requested"
          })
        })
      )
      expect(recordDiagnosticEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "STARTUP_RECOVERY_CANCELLED",
          operation: "startup.recovery.provider-migration",
          metadata: expect.objectContaining({
            status: "cancellation-acknowledged"
          })
        })
      )

      releaseAll()
      await vi.runAllTimersAsync()
      await settle()
    } finally {
      vi.useRealTimers()
    }
  })

  it("never starts provider migration while timed-out backup recovery still mutates", async () => {
    vi.useFakeTimers()
    try {
      const { initializeBackgroundStartup } = await loadStartup()
      initializeBackgroundStartup(Promise.resolve())
      await settle()
      expect(started).toEqual(["backup-import"])

      await vi.advanceTimersByTimeAsync(120_000)
      await settle()

      expect(tasks["backup-import"].signal()?.aborted).toBe(true)
      expect(started).toEqual(["backup-import"])
      expect(inFlight).toBe(1)

      tasks["backup-import"].release()
      await settle()

      expect(finished).toContain("backup-import")
      expect(started).toEqual(["backup-import", "provider-migration"])
      expect(inFlight).toBe(1)

      releaseAll()
      await vi.runAllTimersAsync()
      await settle()
    } finally {
      vi.useRealTimers()
    }
  })

  it("skips database startup when the owner never came up", async () => {
    const { initializeBackgroundStartup } = await loadStartup()
    initializeBackgroundStartup(Promise.reject(new Error("no offscreen slot")))
    await settle()

    expect(started).toEqual([])
    expect(loggerError).toHaveBeenCalledWith(
      "Skipping database startup tasks: persistence owner unavailable",
      "BackgroundSW",
      expect.objectContaining({ error: expect.any(Error) })
    )
  })

  it("skips database startup when lifecycle flags stay unresolved", async () => {
    resumePendingAppLifecycle.mockRejectedValue(new Error("storage offline"))

    const { initializeBackgroundStartup } = await loadStartup()
    initializeBackgroundStartup(Promise.resolve())
    await settle()

    expect(started).toEqual([])
    expect(loggerError).toHaveBeenCalledWith(
      "Skipping database startup tasks: lifecycle state unresolved",
      "BackgroundSW"
    )
  })

  it("keeps recovering after one workflow fails", async () => {
    tasks["resume-turns"].run.mockRejectedValueOnce(new Error("bad turn row"))

    const { initializeBackgroundStartup } = await loadStartup()
    initializeBackgroundStartup(Promise.resolve())
    releaseAll()
    await settle()

    expect(loggerError).toHaveBeenCalledWith(
      "Startup recovery failed: durable turns",
      "BackgroundSW",
      expect.objectContaining({ error: expect.any(Error) })
    )
    expect(finished).toContain("resume-ingestion")
    expect(finished).toContain("resume-pulls")
  })
})
