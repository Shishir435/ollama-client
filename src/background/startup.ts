import { resumeIncompleteTurnRuns } from "@/background/durable-turn-runtime"
import { initializeContextMenu } from "@/background/handlers/handle-context-menu"
import { downloadEmbeddingModelSilently } from "@/background/handlers/handle-embedding-download"
import { updateDNRRules } from "@/background/lib/dnr"
import { registerOmniboxQuickAsk } from "@/background/lib/omnibox"
import { registerReminderAlarms } from "@/background/lib/reminders"
import { clearModelToolCapabilityCache } from "@/background/lib/resolve-model-tools"
import { registerScheduledJobs } from "@/background/lib/scheduled-jobs"
import { resumePendingAppLifecycle } from "@/lib/app-reset"
import { browser, isChromiumBased } from "@/lib/browser-api"
import {
  DEFAULT_EMBEDDING_MODEL,
  EXTERNAL_URLS,
  STORAGE_KEYS
} from "@/lib/constants"
import { IngestionService } from "@/lib/ingestion/ingestion-service"
import { logger } from "@/lib/logger"
import { runEmbeddingDimensionMigration } from "@/lib/migration/embedding-dimension-migration"
import { getPlasmoStoredValue } from "@/lib/plasmo-global-storage"
import { clearOllamaDetailBackfillCache } from "@/lib/providers/ollama"
import { ProviderStorageKey } from "@/lib/providers/types"
import { pruneStaleToolLoopRuns } from "@/lib/repositories/tool-loop-runs"
import { pruneTerminalTurnRuns } from "@/lib/repositories/turn-runs"
import { recoverBackupImport } from "@/lib/storage/backup-import-transaction"
import { migrateLegacyProviderStorage } from "@/lib/storage/provider-migration"
import { getToolRegistry } from "@/lib/tools/build-tool-registry"
import type { ChromeSidePanel } from "@/types"

const openClientWindow = () => {
  browser.windows.create({
    url: browser.runtime.getURL("sidepanel.html"),
    type: "popup",
    width: 420,
    height: 640
  })
}

/**
 * Open the chat surface for a tab: the native side panel on Chromium, a popup
 * window on Firefox (or when no window context is available). Used by the
 * toolbar action's `onClicked` (the keyboard hotkey uses the reserved
 * `_execute_action` command, which toggles the panel natively).
 */
const openPanelForTab = (tab?: { id?: number; windowId?: number }) => {
  if (isChromiumBased() && "sidePanel" in browser) {
    const windowId = tab?.windowId
    if (!windowId) {
      openClientWindow()
      return
    }

    const sidePanel = (browser as unknown as { sidePanel: ChromeSidePanel })
      .sidePanel
    sidePanel.open({ windowId, tabId: tab?.id }).catch((error) => {
      logger.warn(
        "Failed to open side panel, falling back to popup",
        "BackgroundSW",
        { error }
      )
      openClientWindow()
    })
    return
  }

  openClientWindow()
}

const registerActionHandler = () => {
  const actionAPI =
    browser.action ||
    (browser as unknown as { browserAction?: typeof browser.action })
      .browserAction

  if (isChromiumBased() && "sidePanel" in browser) {
    const sidePanel = (
      browser as unknown as {
        sidePanel: ChromeSidePanel
      }
    ).sidePanel

    sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error: Error) =>
        logger.error("SidePanel error", "BackgroundSW", { error })
      )

    if (actionAPI) {
      actionAPI.onClicked.addListener((tab) => openPanelForTab(tab))
    }
    return
  }

  if (actionAPI) {
    actionAPI.onClicked.addListener(() => {
      openClientWindow()
    })
  }
}

const registerInstallHandlers = () => {
  if (!isChromiumBased()) {
    logger.warn(
      "DNR not available: skipping CORS workaround (likely Firefox)",
      "BackgroundSW"
    )
    return
  }

  browser.runtime.onInstalled.addListener(async (details) => {
    updateDNRRules()

    if (details.reason !== "install") return

    logger.info(
      "Extension installed - downloading embedding model",
      "BackgroundSW"
    )

    const alreadyDownloaded = await getPlasmoStoredValue<boolean>(
      STORAGE_KEYS.EMBEDDINGS.AUTO_DOWNLOADED
    )

    if (alreadyDownloaded) return

    downloadEmbeddingModelSilently(DEFAULT_EMBEDDING_MODEL)
      .then((result) => {
        if (result.success) {
          logger.info(
            `Successfully downloaded embedding model: ${DEFAULT_EMBEDDING_MODEL}`,
            "BackgroundSW"
          )
          return
        }

        logger.warn(
          `Failed to auto-download embedding model: ${result.error}`,
          "BackgroundSW"
        )
      })
      .catch((error) => {
        logger.error("Error during embedding model download", "BackgroundSW", {
          error
        })
      })
  })

  browser.runtime.onStartup.addListener(() => updateDNRRules())
}

/**
 * Point the browser's post-uninstall tab at the docs feedback page. Runs on
 * both Chromium and Firefox (both implement setUninstallURL), so it is NOT
 * gated behind isChromiumBased(). Set on every worker boot so the version
 * param tracks upgrades. Only anonymous context is attached — extension
 * version and UI locale — so a churn spike can be traced to a release without
 * identifying the user.
 */
const setUninstallFeedbackURL = () => {
  if (!browser.runtime?.setUninstallURL) return

  try {
    const params = new URLSearchParams({
      v: browser.runtime.getManifest().version,
      l: browser.i18n?.getUILanguage?.() ?? "en"
    })
    void browser.runtime
      .setUninstallURL(
        `${EXTERNAL_URLS.UNINSTALL_FEEDBACK}?${params.toString()}`
      )
      .catch((error) => {
        logger.warn("Failed to set uninstall feedback URL", "BackgroundSW", {
          error
        })
      })
  } catch (error) {
    logger.warn("Failed to set uninstall feedback URL", "BackgroundSW", {
      error
    })
  }
}

const registerToolRegistryInvalidation = () => {
  if (!browser.storage?.onChanged) return

  browser.storage.onChanged.addListener((changes) => {
    if (STORAGE_KEYS.WEB_SEARCH.CONFIG in changes) {
      getToolRegistry().invalidate()
    }
    if (ProviderStorageKey.CONFIG in changes) {
      clearModelToolCapabilityCache()
      clearOllamaDetailBackfillCache()
      void updateDNRRules()
    }
  })
}

/**
 * Resolves true when lifecycle flags were read and handled (or none exist);
 * false when even a retry could not resolve them — in that case a pending
 * destructive reset may still be queued, so database startup must not run.
 */
const resumeLifecycleWithRetry = async (): Promise<boolean> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await resumePendingAppLifecycle()
      return true
    } catch (error) {
      logger.error("Failed to resume app lifecycle actions", "BackgroundSW", {
        attempt,
        error
      })
    }
  }
  return false
}

interface StartupTask {
  name: string
  run: () => Promise<unknown>
}

/**
 * Data-shape recovery, in order and alone.
 *
 * Backup import recovery can replace the whole database, and both migrations
 * rewrite rows other recovery reads. Running them beside workflow recovery —
 * which is what every one of these being `void`ed used to do — let a resumed
 * turn read a database that was mid-replacement.
 */
const SCHEMA_STARTUP_TASKS: StartupTask[] = [
  {
    name: "interrupted settings import",
    run: async () => {
      await recoverBackupImport()
      await migrateLegacyProviderStorage()
    }
  },
  {
    name: "embedding dimension migration",
    run: () => runEmbeddingDimensionMigration()
  }
]

/**
 * Durable workflow recovery. Independent of each other, so they overlap — but
 * with a cap, because a conversation long enough to make turn recovery slow
 * should not hold up an ingestion job the user is waiting on.
 */
const WORKFLOW_STARTUP_TASKS: StartupTask[] = [
  { name: "stale tool-loop checkpoints", run: () => pruneStaleToolLoopRuns() },
  { name: "durable turns", run: () => resumeIncompleteTurnRuns() },
  // Ordered after turn recovery in the same list rather than before it: the
  // prune only touches settled rows, so it cannot race resumption, and a boot
  // should reissue interrupted work before it does housekeeping.
  { name: "expired turn receipts", run: () => pruneTerminalTurnRuns() },
  { name: "durable ingestion", run: () => IngestionService.resumeIncomplete() },
  {
    name: "durable model pulls",
    run: () =>
      import("@/background/model-pull-runtime").then(({ ModelPullService }) =>
        ModelPullService.resumeIncomplete()
      )
  }
]

const WORKFLOW_STARTUP_CONCURRENCY = 2

/**
 * Nothing at startup may block the boot forever.
 *
 * Data-shape recovery runs in series because each step rewrites what the next
 * one reads, which also means a step that never settles takes every later step
 * and all four workflow recoveries with it. The deadline unblocks the sequence.
 * Generous on purpose: these are one-shot boot tasks, and a large migration is
 * slow rather than stuck.
 *
 * It **abandons** the task; it does not cancel it. None of these operations
 * accepts an `AbortSignal` today, so a timed-out migration keeps running
 * alongside whatever starts next. That is still better than a boot where
 * nothing after it runs at all, but it is a stopgap: threading cancellation
 * through the startup tasks is tracked in `RELEASE_ROADMAP.md`.
 */
const STARTUP_TASK_TIMEOUT_MS = 120_000

const withStartupDeadline = async (task: StartupTask): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      task.run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Startup task abandoned after ${STARTUP_TASK_TIMEOUT_MS}ms and may still be running: ${task.name}`
              )
            ),
          STARTUP_TASK_TIMEOUT_MS
        )
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

const runStartupTask = async (task: StartupTask): Promise<void> => {
  try {
    await withStartupDeadline(task)
  } catch (error) {
    // One failed recovery never cancels the others: they own unrelated durable
    // state, and a boot that recovers three of four beats a boot that recovers
    // none.
    logger.error(`Startup recovery failed: ${task.name}`, "BackgroundSW", {
      error
    })
  }
}

const runStartupTasks = async (
  tasks: StartupTask[],
  concurrency: number
): Promise<void> => {
  let next = 0
  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    async () => {
      while (next < tasks.length) {
        const task = tasks[next]
        next += 1
        await runStartupTask(task)
      }
    }
  )
  await Promise.all(workers)
}

/**
 * Everything that touches the chat database, in dependency order:
 * lifecycle flags → persistence owner → schema/data recovery → durable
 * workflow recovery.
 */
const runDatabaseStartup = async (
  lifecycleReady: Promise<boolean>,
  persistenceReady: Promise<void>
): Promise<void> => {
  // Observed before the lifecycle branch can return early: an owner failure
  // nobody awaited is an unhandled rejection in the worker.
  const persistenceFailure = persistenceReady.then(
    () => undefined,
    (error: unknown) => error ?? new Error("Persistence owner failed to start")
  )
  if (!(await lifecycleReady)) {
    // A queued reset may still exist; opening the database now could block
    // its delete on the next boot. Skip DB-touching startup for this boot —
    // the flags are retried on the next worker start.
    logger.error(
      "Skipping database startup tasks: lifecycle state unresolved",
      "BackgroundSW"
    )
    return
  }
  const error = await persistenceFailure
  if (error) {
    // Every task below would otherwise wait out a 30s client timeout each and
    // fail anyway. The owner is retried on the next worker start.
    logger.error(
      "Skipping database startup tasks: persistence owner unavailable",
      "BackgroundSW",
      { error }
    )
    return
  }
  await runStartupTasks(SCHEMA_STARTUP_TASKS, 1)
  await runStartupTasks(WORKFLOW_STARTUP_TASKS, WORKFLOW_STARTUP_CONCURRENCY)
}

export const initializeBackgroundStartup = (
  persistenceReady: Promise<void> = Promise.resolve()
) => {
  // A scheduled destructive reset must complete before any other startup
  // task opens the chat database — an open handle would block the delete.
  const lifecycleReady = resumeLifecycleWithRetry()
  void runDatabaseStartup(lifecycleReady, persistenceReady)
  // MV3 workers can start without a browser onStartup event (extension reload,
  // event wakeup). Reconcile the request-origin rule on every worker boot.
  void updateDNRRules()
  initializeContextMenu()
  registerActionHandler()
  registerInstallHandlers()
  setUninstallFeedbackURL()
  registerToolRegistryInvalidation()
  registerOmniboxQuickAsk(openPanelForTab)
  registerScheduledJobs()
  registerReminderAlarms()
  registerAlarmPermissionReactivation()
}

/**
 * `alarms` is an optional permission (0.11.15). When granted mid-session the API
 * namespace appears, but the startup registration already ran while it was
 * absent and added no listeners. Re-run registration (and re-sync periodic jobs)
 * on grant so reminders/scheduled jobs start working without a restart. The
 * register* functions are idempotent, so a later real SW restart is harmless.
 */
const registerAlarmPermissionReactivation = () => {
  browser.permissions?.onAdded?.addListener((perms) => {
    // `alarms` isn't in the polyfill's optional-permission union (see
    // src/lib/permissions.ts); compare as plain strings.
    const granted = (perms.permissions ?? []) as string[]
    if (!granted.includes("alarms")) return
    // `registerScheduledJobs` re-syncs periodic-job alarms itself, so there's
    // no separate `syncScheduledJobAlarms` call here.
    registerScheduledJobs()
    registerReminderAlarms()
  })
}
