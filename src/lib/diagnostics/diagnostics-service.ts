import { vectorDb } from "@/lib/embeddings/db"
import { readPersistenceBackend } from "@/lib/persistence/backend"
import { rpcQuery, rpcTxBegin, rpcTxRollback } from "@/lib/persistence/client"
import { ProviderManager } from "@/lib/providers/manager"
import { ProviderRpcService } from "@/lib/providers/provider-rpc-service"
import { countMessages } from "@/lib/repositories/chat-history"
import type {
  DiagnosticsGetBundleResult,
  DiagnosticsRunResult,
  DiagnosticTestResult
} from "@/protocol/diagnostics-rpc"

import {
  clearDiagnosticEvents,
  getDiagnosticEvents,
  recordDiagnosticEvent
} from "./diagnostic-recorder"

const elapsed = (startedAt: number) =>
  Math.max(0, performance.now() - startedAt)

const runTest = async (
  id: string,
  test: () => Promise<
    Record<string, string | number | boolean | null> | undefined
  >
): Promise<DiagnosticTestResult> => {
  const startedAt = performance.now()
  try {
    const metadata = await test()
    return {
      id,
      status: "pass",
      durationMs: elapsed(startedAt),
      ...(metadata && { metadata })
    }
  } catch {
    return {
      id,
      status: "fail",
      durationMs: elapsed(startedAt),
      code: `OLC-${id.replaceAll("_", "-").toUpperCase()}-001`
    }
  }
}

const storageRoundTrip = async (
  area: chrome.storage.StorageArea
): Promise<undefined> => {
  const key = `diagnostic-self-test-${crypto.randomUUID()}`
  const value = crypto.randomUUID()
  try {
    await area.set({ [key]: value })
    const read = await area.get(key)
    if (read[key] !== value) throw new Error("storage roundtrip mismatch")
  } finally {
    await area.remove(key)
  }
  return undefined
}

const capabilities = () => ({
  tabs: Boolean(chrome.tabs),
  permissions: Boolean(chrome.permissions),
  sessions: Boolean(chrome.sessions),
  declarativeNetRequest: Boolean(chrome.declarativeNetRequest),
  offscreen: Boolean(chrome.offscreen)
})

const permissions = async (): Promise<Record<string, boolean>> => {
  if (!chrome.permissions?.getAll) return {}
  const granted = await chrome.permissions.getAll()
  const names = new Set(granted.permissions ?? [])
  return {
    tabs: names.has("tabs"),
    sessions: names.has("sessions"),
    history: names.has("history"),
    bookmarks: names.has("bookmarks"),
    notifications: names.has("notifications")
  }
}

const browserFamily = () => {
  const ua = navigator.userAgent
  if (/Firefox/i.test(ua)) return "firefox"
  if (/Edg/i.test(ua)) return "edge"
  if (/Chrom/i.test(ua)) return "chromium"
  return "other"
}

const osFamily = () => {
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return "windows"
  if (/Mac OS|Macintosh/i.test(ua)) return "macos"
  if (/Linux/i.test(ua)) return "linux"
  return "other"
}

const runMigrationTest = async (): Promise<DiagnosticTestResult> => {
  const result = await runTest("migration", async () => ({
    result: await readPersistenceBackend()
  }))
  if (result.status === "pass" && result.metadata?.result === "legacy") {
    return {
      ...result,
      status: "action",
      code: "OLC-STORAGE-MIGRATION-001"
    }
  }
  return result
}

export const DiagnosticsService = {
  async run(signal?: AbortSignal): Promise<DiagnosticsRunResult> {
    const tests = await Promise.all([
      runTest("runtime_version", async () => {
        const version = chrome.runtime.getManifest().version
        if (!version) throw new Error("missing version")
        return { result: "available" }
      }),
      runTest("browser_apis", async () => ({
        count: Object.values(capabilities()).filter(Boolean).length
      })),
      runTest("permissions", async () => ({
        count: Object.values(await permissions()).filter(Boolean).length
      })),
      runTest("sync_storage", () => storageRoundTrip(chrome.storage.sync)),
      runTest("local_storage", () => storageRoundTrip(chrome.storage.local)),
      runTest("chat_repository", async () => {
        const token = `diagnostic-${crypto.randomUUID()}`
        let began = false
        try {
          await rpcTxBegin(token)
          began = true
          const rows = await rpcQuery("SELECT 1 AS ok", undefined, token)
          if (rows[0]?.ok !== 1) throw new Error("transaction smoke mismatch")
        } finally {
          if (began) await rpcTxRollback(token)
        }
        const count = await countMessages()
        return { count }
      }),
      runTest("vector_store", async () => ({
        count: await vectorDb.vectors.count()
      })),
      runTest("provider_discovery", async () => {
        const result = await ProviderRpcService.listModels(
          {
            enabledOnly: true
          },
          signal
        )
        return {
          count: result.models.length,
          status: result.failures.length > 0 ? "partial" : "pass"
        }
      }),
      runMigrationTest()
    ])
    signal?.throwIfAborted()
    await recordDiagnosticEvent({
      level: tests.every((test) => test.status === "pass") ? "info" : "warn",
      code: "DIAGNOSTICS_SELF_TEST_COMPLETED",
      operation: "diagnostics.run",
      surface: "background",
      metadata: {
        count: tests.length,
        result: tests.some((test) => test.status === "fail")
          ? "failure"
          : tests.some((test) => test.status === "action")
            ? "action"
            : "pass"
      }
    })
    return { tests }
  },

  async getBundle(signal?: AbortSignal): Promise<DiagnosticsGetBundleResult> {
    const [
      providers,
      events,
      selfTests,
      permissionState,
      messageCount,
      vectorCount
    ] = await Promise.all([
      ProviderManager.getProviders(),
      getDiagnosticEvents(),
      this.run(signal).then((result) => result.tests),
      permissions(),
      countMessages(),
      vectorDb.vectors.count()
    ])
    signal?.throwIfAborted()
    const backend = await readPersistenceBackend()
    return {
      bundle: {
        format: "ollama-client-support-v1",
        createdAt: Date.now(),
        appVersion: chrome.runtime.getManifest().version,
        browserFamily: browserFamily(),
        osFamily: osFamily(),
        capabilities: capabilities(),
        permissions: permissionState,
        providers: providers.map((provider) => ({
          profile: String(provider.serviceProfile ?? "generic"),
          wire: String(provider.type),
          enabled: provider.enabled
        })),
        storage: { backend, messageCount, vectorCount },
        events,
        selfTests
      }
    }
  },

  async clear() {
    await clearDiagnosticEvents()
    return { cleared: true as const }
  }
}
