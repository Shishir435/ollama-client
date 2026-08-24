import {
  RPC_PROTOCOL_VERSION,
  RPC_REQUEST_MESSAGE_TYPE,
  RpcMethod
} from "@ollama-client/contracts/rpc"
import type { SqlJsStatic } from "sql.js"
import initSqlJs from "sql.js/dist/sql-wasm.js"
import { browser } from "@/lib/browser-api"
import {
  MESSAGE_KEYS,
  SQLITE_DB_KEY,
  SQLITE_DB_NAME,
  SQLITE_DB_STORE,
  STORAGE_KEYS
} from "@/lib/constants"
import {
  ensureDefaultKnowledgeSet,
  updateKnowledgeSet
} from "@/lib/knowledge/knowledge-sets"
import {
  invalidateBackendCache,
  readPersistenceBackend
} from "@/lib/persistence/backend"
import { DURABLE_TABLES } from "@/lib/persistence/durable-tables"
import { ProviderManager } from "@/lib/providers/manager"
import { ProviderId } from "@/lib/providers/types"
import * as chatHistory from "@/lib/repositories/sqlite-chat-history"
import { getToolLoopRun } from "@/lib/repositories/tool-loop-runs"
import {
  createTurnRun,
  getTurnRun,
  updateTurnRun
} from "@/lib/repositories/turn-runs"
import {
  createFixture,
  type Scale
} from "@/lib/sqlite/benchmark/persistence-benchmark-core"
import {
  exportPersistedDatabaseBytes,
  importDatabaseBytes,
  query
} from "@/lib/sqlite/db"
import { LATEST_SCHEMA_VERSION } from "@/lib/sqlite/migrations/migration-runner"
import { writeSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"
import {
  CHAT_STREAM_EVENT_TYPES,
  STREAM_PROTOCOL_VERSION
} from "@/protocol/streams"

/**
 * Dev-only verification surface for the production OPFS migration. Every
 * call below exercises the REAL production path: the repository facade, the
 * backend dispatcher, the persistence RPC, and the owner worker. Only the
 * legacy-blob seeding writes directly, because it must reproduce what an
 * unmigrated 0.11.x profile leaves behind.
 *
 * Extension APIs go through `browser`, never the `chrome` alias: on Firefox
 * the `chrome` namespace is callback-only, so `await chrome.storage.local.get`
 * resolves to undefined rather than the stored value. That made every hook
 * here silently unusable on the Firefox runner while working on Chromium.
 */

/**
 * Rows the fixture adds outside sessions/messages, so per-table migration
 * verification has something to verify.
 */
const PROMPT_TEMPLATE_SEED = 7
const KV_SEED = 3

interface VerifyStream {
  events: unknown[]
  port: ReturnType<typeof browser.runtime.connect>
}

const verifyStreams = new Map<string, VerifyStream>()

const connectTurn = (turnId: string, afterSeq?: number): VerifyStream => {
  const port = browser.runtime.connect({
    name: MESSAGE_KEYS.PROVIDER.STREAM_RESPONSE
  })
  const stream: VerifyStream = { events: [], port }
  port.onMessage.addListener((event) => stream.events.push(event))
  verifyStreams.get(turnId)?.port.disconnect()
  verifyStreams.set(turnId, stream)
  if (afterSeq !== undefined) {
    port.postMessage({
      version: STREAM_PROTOCOL_VERSION,
      type: MESSAGE_KEYS.PROVIDER.RECONNECT_STREAM,
      payload: { requestId: turnId, afterSeq }
    })
  }
  return stream
}

const buildContextThroughRuntime = (requestId: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const port = browser.runtime.connect({
      name: MESSAGE_KEYS.PROVIDER.STREAM_RESPONSE
    })
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error("Context build did not settle"))
    }, 30_000)
    const cleanup = () => {
      clearTimeout(timer)
      port.onMessage.removeListener(onMessage)
      port.disconnect()
    }
    const onMessage = (event: unknown) => {
      if (!event || typeof event !== "object") return
      if (Reflect.get(event, "requestId") !== requestId) return
      const type = Reflect.get(event, "type")
      if (type === CHAT_STREAM_EVENT_TYPES.CONTEXT_RESULT) {
        cleanup()
        resolve()
        return
      }
      if (type !== CHAT_STREAM_EVENT_TYPES.CONTEXT_ERROR) return
      const failure = Reflect.get(event, "failure")
      cleanup()
      reject(
        new Error(
          failure && typeof failure === "object"
            ? String(
                Reflect.get(failure, "userMessage") ??
                  Reflect.get(failure, "message") ??
                  "Context build failed"
              )
            : "Context build failed"
        )
      )
    }
    port.onMessage.addListener(onMessage)
    port.postMessage({
      version: STREAM_PROTOCOL_VERSION,
      type: MESSAGE_KEYS.PROVIDER.BUILD_CONTEXT,
      payload: {
        requestId,
        turnId: requestId,
        rawInput: "What does the document say about model loading?",
        messages: [
          { role: "user", content: "Remember the runtime settings." },
          {
            role: "assistant",
            content: "I will preserve them.",
            done: true
          }
        ],
        hasTabContext: false,
        contextText: "",
        tabDocuments: [],
        memoryEnabled: false,
        maxTabContextChars: 1_000,
        maxRagContextChars: 1_000,
        groundedOnlyMode: false,
        selectedModel: "verify-model",
        selectedModelRef: {
          providerId: ProviderId.OLLAMA,
          modelId: "verify-model"
        }
      }
    })
  })

/**
 * Resolve once the tab has committed its requested document. onUpdated is
 * attached before the first get() so a status change between the two is not
 * lost, and a settled tab short-circuits without waiting for an event that
 * has already fired.
 */
const waitForTabComplete = (tabId: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Tab ${tabId} did not finish loading`))
    }, 10_000)
    const cleanup = () => {
      clearTimeout(timer)
      browser.tabs.onUpdated.removeListener(onUpdated)
    }
    const onUpdated = (updatedTabId: number, change: { status?: string }) => {
      if (updatedTabId !== tabId || change.status !== "complete") return
      cleanup()
      resolve()
    }
    browser.tabs.onUpdated.addListener(onUpdated)
    browser.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status !== "complete") return
        cleanup()
        resolve()
      })
      .catch((error) => {
        cleanup()
        reject(error)
      })
  })

const makeTurnRequest = (
  prompt: string,
  providerId: string = ProviderId.OLLAMA
) => ({
  version: 1 as const,
  context: {
    rawInput: prompt,
    messages: [],
    hasTabContext: false,
    contextText: "",
    tabDocuments: [],
    memoryEnabled: false,
    maxTabContextChars: 1_000,
    maxRagContextChars: 1_000,
    groundedOnlyMode: false,
    selectedModel: "verify-model",
    selectedModelRef: {
      providerId,
      modelId: "verify-model"
    }
  },
  userMessage: { role: "user" as const, content: prompt }
})

const putLegacyBlob = async (bytes: Uint8Array): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(SQLITE_DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SQLITE_DB_STORE)) {
        request.result.createObjectStore(SQLITE_DB_STORE)
      }
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const tx = database.transaction([SQLITE_DB_STORE], "readwrite")
      tx.oncomplete = () => {
        database.close()
        resolve()
      }
      tx.onerror = () => {
        database.close()
        reject(tx.error)
      }
      tx.objectStore(SQLITE_DB_STORE).put(bytes, SQLITE_DB_KEY)
    }
  })

const readLegacyBlobLength = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(SQLITE_DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SQLITE_DB_STORE)) {
        request.result.createObjectStore(SQLITE_DB_STORE)
      }
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const get = database
        .transaction([SQLITE_DB_STORE], "readonly")
        .objectStore(SQLITE_DB_STORE)
        .get(SQLITE_DB_KEY)
      get.onsuccess = () => {
        database.close()
        resolve(get.result instanceof Uint8Array ? get.result.byteLength : 0)
      }
      get.onerror = () => {
        database.close()
        reject(get.error)
      }
    }
  })

const readLegacyBlobDigest = async (): Promise<string> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(SQLITE_DB_NAME, 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const get = database
        .transaction([SQLITE_DB_STORE], "readonly")
        .objectStore(SQLITE_DB_STORE)
        .get(SQLITE_DB_KEY)
      get.onsuccess = async () => {
        database.close()
        if (!(get.result instanceof Uint8Array)) {
          resolve("")
          return
        }
        try {
          const bytes = Uint8Array.from(get.result)
          const digest = await crypto.subtle.digest("SHA-256", bytes.buffer)
          resolve(
            [...new Uint8Array(digest)]
              .map((value) => value.toString(16).padStart(2, "0"))
              .join("")
          )
        } catch (error) {
          reject(error)
        }
      }
      get.onerror = () => {
        database.close()
        reject(get.error)
      }
    }
  })

const verifyApi = {
  async backendMarker(): Promise<unknown> {
    const stored = await browser.storage.local.get(
      STORAGE_KEYS.PERSISTENCE.BACKEND
    )
    return stored[STORAGE_KEYS.PERSISTENCE.BACKEND] ?? null
  },

  async clearMarker(): Promise<void> {
    await browser.storage.local.remove(STORAGE_KEYS.PERSISTENCE.BACKEND)
  },

  async migrationReceipt(): Promise<unknown> {
    const stored = await browser.storage.local.get(
      STORAGE_KEYS.PERSISTENCE.MIGRATION_RECEIPT
    )
    return stored[STORAGE_KEYS.PERSISTENCE.MIGRATION_RECEIPT] ?? null
  },

  async clearMigrationReceipt(): Promise<void> {
    await browser.storage.local.remove(
      STORAGE_KEYS.PERSISTENCE.MIGRATION_RECEIPT
    )
  },

  /** Operator recovery switch, written the way an operator would: device-local
   * storage only. Read back through the production backend resolver. */
  async setLegacyOverride(enabled: boolean): Promise<void> {
    if (enabled) {
      await browser.storage.local.set({
        [STORAGE_KEYS.PERSISTENCE.LEGACY_OVERRIDE]: true
      })
      return
    }
    await browser.storage.local.remove(STORAGE_KEYS.PERSISTENCE.LEGACY_OVERRIDE)
  },

  async activeBackend(): Promise<string> {
    invalidateBackendCache()
    return readPersistenceBackend()
  },

  /** Reproduce an unmigrated profile: build a real sql.js database with the
   * section 9.8 fixture generator and persist it as the legacy blob. */
  async seedLegacyBlob(
    chats: number,
    messages: number
  ): Promise<{
    sessions: number
    messages: number
    blobBytes: number
    tables: Record<string, number>
  }> {
    const wasmUrl = browser.runtime.getURL("assets/sql-wasm.wasm")
    const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer()
    const SQL = await (
      initSqlJs as unknown as (config: {
        wasmBinary: Uint8Array
      }) => Promise<SqlJsStatic>
    )({ wasmBinary: new Uint8Array(wasmBinary) })
    const scale: Scale = { chats, messages }
    const fixture = createFixture(SQL, scale)
    try {
      // createFixture uses the latest schema but intentionally leaves
      // user_version at zero for benchmark portability. A current legacy
      // profile is already stamped; mirror that state here so this fixture can
      // detect migration writes to the rollback blob instead of observing the
      // legacy backend's expected one-time schema-version stamp.
      fixture.run(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION}`)
      // Seed beyond sessions/messages so migration verification is exercised
      // on tables the chat list never reads: a blob that only ever carries
      // chats cannot prove per-table verification works.
      for (let index = 0; index < PROMPT_TEMPLATE_SEED; index += 1) {
        fixture.run(
          `INSERT INTO prompt_templates
             (id, title, userPrompt, createdAt, usageCount, sortOrder)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            `verify-template-${index}`,
            `Template ${index}`,
            "prompt",
            1,
            0,
            index
          ]
        )
      }
      for (let index = 0; index < KV_SEED; index += 1) {
        fixture.run("INSERT INTO kv_store (key, value) VALUES (?, ?)", [
          `verify-key-${index}`,
          `value-${index}`
        ])
      }
      const tables: Record<string, number> = {}
      for (const table of DURABLE_TABLES) {
        const result = fixture.exec(`SELECT COUNT(*) FROM "${table}"`)
        tables[table] = Number(result[0]?.values?.[0]?.[0] ?? 0)
      }
      const bytes = fixture.export()
      await putLegacyBlob(bytes)
      return {
        sessions: chats,
        messages,
        blobBytes: bytes.byteLength,
        tables
      }
    } finally {
      fixture.close()
    }
  },

  readLegacyBlobLength,
  readLegacyBlobDigest,

  /** Row counts through the production path (facade → RPC → owner). */
  async counts(): Promise<{
    sessions: number
    messages: number
    tables: Record<string, number>
  }> {
    const tables: Record<string, number> = {}
    for (const table of DURABLE_TABLES) {
      const rows = await query(`SELECT COUNT(*) AS n FROM "${table}"`)
      tables[table] = Number(rows[0]?.n ?? 0)
    }
    return {
      sessions: tables.sessions ?? 0,
      messages: tables.messages ?? 0,
      tables
    }
  },

  /** Integrity of the live database, read through the production path. */
  async integrityInfo(): Promise<{
    integrityCheck: string
    foreignKeyViolations: number
  }> {
    const integrityRows = await query("PRAGMA integrity_check")
    const fkRows = await query("PRAGMA foreign_key_check")
    return {
      integrityCheck:
        integrityRows
          .map((row) => String(Object.values(row)[0] ?? ""))
          .filter((line) => line.length > 0)
          .join("; ") || "ok",
      foreignKeyViolations: fkRows.length
    }
  },

  /** Real repository write, exactly what the chat UI performs. */
  async appendViaFacade(sessionId: string, count: number): Promise<number> {
    const now = Date.now()
    await chatHistory.addSession({
      id: sessionId,
      title: `verify ${sessionId}`,
      modelId: "verify-model",
      createdAt: now,
      updatedAt: now,
      messages: []
    })
    let lastId = 0
    for (let index = 0; index < count; index += 1) {
      lastId = await chatHistory.appendMessage({
        sessionId,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `verify message ${index}`,
        timestamp: now + index
      })
    }
    return lastId
  },

  async configureFakeOllama(baseUrl: string): Promise<void> {
    await this.configureFakeProvider(ProviderId.OLLAMA, baseUrl)
  },

  async configureFakeProvider(
    providerId: string,
    baseUrl: string
  ): Promise<void> {
    await ProviderManager.updateProviderConfig(providerId, {
      enabled: true,
      baseUrl,
      customModels: ["verify-model"]
    })
  },

  /** Reproduce the #315 sequence through the packaged background: RAG query
   * rewriting calls the selected model before the durable chat call. Both
   * requests must carry the same model-loading options or Ollama unloads and
   * reloads the model between them. */
  async buildConfiguredRagContext(requestId: string): Promise<void> {
    await writeSetting(SETTINGS.USE_RAG, true)
    await writeSetting(SETTINGS.MODEL_CONFIGS, {
      [`${ProviderId.OLLAMA}::verify-model`]: {
        num_ctx: 8192,
        num_thread: 8,
        num_gpu: 20,
        num_batch: 256,
        keep_alive: "15m"
      }
    })
    const knowledgeSet = await ensureDefaultKnowledgeSet()
    await updateKnowledgeSet(knowledgeSet.id, {
      questionPrompt:
        "Rewrite the question as one standalone search query: {question}"
    })
    await buildContextThroughRuntime(requestId)
  },

  /** Submit through the real durable port contract. Only row creation mirrors
   * the UI; lifecycle ownership begins when START_TURN reaches background. */
  async startDurableTurn(
    turnId: string,
    prompt: string,
    providerId: string = ProviderId.OLLAMA
  ): Promise<number> {
    const now = Date.now()
    const sessionId = `session-${turnId}`
    const request = makeTurnRequest(prompt, providerId)
    await chatHistory.addSession({
      id: sessionId,
      title: `verify ${turnId}`,
      modelId: "verify-model",
      createdAt: now,
      updatedAt: now,
      messages: []
    })
    const userMessageId = await chatHistory.appendMessage({
      sessionId,
      role: "user",
      content: prompt,
      timestamp: now
    })
    const assistantMessageId = await chatHistory.appendMessage({
      sessionId,
      role: "assistant",
      content: "",
      model: "verify-model",
      parentId: userMessageId,
      done: false,
      timestamp: now + 1
    })
    const stream = connectTurn(turnId)
    stream.port.postMessage({
      version: STREAM_PROTOCOL_VERSION,
      type: MESSAGE_KEYS.PROVIDER.START_TURN,
      payload: {
        start: {
          submission: {
            id: turnId,
            sessionId,
            mode: "new",
            model: "verify-model",
            providerId,
            request,
            createdAt: now
          },
          userMessageId
        },
        assistantMessageId
      }
    })
    return assistantMessageId
  },

  async reconnectTurn(turnId: string): Promise<void> {
    const prior = verifyStreams.get(turnId)
    const lastSeq =
      prior?.events.reduce<number>((highest, event) => {
        if (!event || typeof event !== "object" || !("seq" in event)) {
          return highest
        }
        const seq = Reflect.get(event, "seq")
        return typeof seq === "number" ? Math.max(highest, seq) : highest
      }, -1) ?? -1
    prior?.port.disconnect()
    connectTurn(turnId, lastSeq)
  },

  async turnEventTypes(turnId: string): Promise<string[]> {
    return (verifyStreams.get(turnId)?.events ?? []).flatMap((event) => {
      if (!event || typeof event !== "object" || !("type" in event)) return []
      const type = Reflect.get(event, "type")
      return typeof type === "string" ? [type] : []
    })
  },

  async turnEventSummary(turnId: string): Promise<{
    completedSnapshots: number
    eventTypes: string[]
    snapshots: number
    terminalChunks: number
  }> {
    const eventTypes: string[] = []
    let completedSnapshots = 0
    let snapshots = 0
    let terminalChunks = 0
    for (const event of verifyStreams.get(turnId)?.events ?? []) {
      if (!event || typeof event !== "object") continue
      const type = Reflect.get(event, "type")
      if (typeof type === "string") eventTypes.push(type)
      if (type === CHAT_STREAM_EVENT_TYPES.SNAPSHOT) {
        snapshots += 1
        if (Reflect.get(event, "status") === "completed") {
          completedSnapshots += 1
        }
      }
      if (
        type === CHAT_STREAM_EVENT_TYPES.CHUNK &&
        (Reflect.get(event, "done") === true ||
          Reflect.get(event, "aborted") === true ||
          Reflect.get(event, "error") !== undefined)
      ) {
        terminalChunks += 1
      }
    }
    return { completedSnapshots, eventTypes, snapshots, terminalChunks }
  },

  async stopTurn(turnId: string): Promise<void> {
    const stream = verifyStreams.get(turnId) ?? connectTurn(turnId, -1)
    stream.port.postMessage({
      version: STREAM_PROTOCOL_VERSION,
      type: MESSAGE_KEYS.PROVIDER.STOP_GENERATION,
      payload: { requestId: turnId }
    })
  },

  async toolLoopResult(requestId: string): Promise<unknown> {
    const run = await getToolLoopRun(requestId)
    return run
      ? {
          status: run.status,
          callId: run.state.toolRuns.find(
            (toolRun) => toolRun.status === "awaiting-confirmation"
          )?.callId
        }
      : null
  },

  async confirmTool(callId: string, approved: boolean): Promise<unknown> {
    return browser.runtime.sendMessage({
      type: MESSAGE_KEYS.PROVIDER.CONFIRM_TOOL,
      payload: { callId, approved }
    })
  },

  /** Raw wire call bypasses client-side validation so browser evidence covers
   * the background schema boundary itself. */
  async malformedSettingsRpc(): Promise<unknown> {
    return browser.runtime.sendMessage({
      type: RPC_REQUEST_MESSAGE_TYPE,
      version: RPC_PROTOCOL_VERSION,
      requestId: crypto.randomUUID(),
      method: RpcMethod.ProvidersSetEnabled,
      request: { providerId: ProviderId.OLLAMA, enabled: "yes" }
    })
  },

  /** Execute in a normal tab's isolated world. Sender evidence therefore has
   * a tab and a web URL: exactly the content-script classification. */
  async contentScriptSettingsRpc(url: string): Promise<unknown> {
    const tab = await browser.tabs.create({ url, active: false })
    if (typeof tab.id !== "number") throw new Error("Created tab has no id")
    try {
      // Injecting mid-navigation either targets the transient about:blank or
      // rejects outright, so the 403 has to be earned from the settled page.
      await waitForTabComplete(tab.id)
      const results = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: async (messageType, version, method) =>
          chrome.runtime.sendMessage({
            type: messageType,
            version,
            requestId: crypto.randomUUID(),
            method,
            request: {}
          }),
        args: [
          RPC_REQUEST_MESSAGE_TYPE,
          RPC_PROTOCOL_VERSION,
          RpcMethod.ProvidersList
        ]
      })
      return results[0]?.result
    } finally {
      await browser.tabs.remove(tab.id)
    }
  },

  /** Seed exactly what an interrupted worker leaves behind: canonical message
   * rows plus a generating turn carrying the resumable request. */
  async seedGeneratingTurn(turnId: string): Promise<number> {
    const now = Date.now()
    const sessionId = `session-${turnId}`
    await chatHistory.addSession({
      id: sessionId,
      title: "durable restart verification",
      modelId: "verify-model",
      createdAt: now,
      updatedAt: now,
      messages: []
    })
    const userMessageId = await chatHistory.appendMessage({
      sessionId,
      role: "user",
      content: "resume after restart",
      timestamp: now
    })
    const assistantMessageId = await chatHistory.appendMessage({
      sessionId,
      role: "assistant",
      content: "",
      model: "verify-model",
      parentId: userMessageId,
      done: false,
      timestamp: now + 1
    })
    await createTurnRun({
      id: turnId,
      sessionId,
      mode: "new",
      model: "verify-model",
      providerId: ProviderId.OLLAMA,
      createdAt: now,
      request: makeTurnRequest("resume after restart")
    })
    await updateTurnRun(turnId, {
      status: "building_context",
      userMessageId,
      assistantMessageId
    })
    await updateTurnRun(turnId, { status: "generating" })
    return assistantMessageId
  },

  async durableTurnResult(
    turnId: string,
    assistantMessageId: number
  ): Promise<{ status?: string; content?: string; done?: boolean }> {
    const [turn, assistant] = await Promise.all([
      getTurnRun(turnId),
      chatHistory.getMessage(assistantMessageId)
    ])
    return {
      status: turn?.status,
      content: assistant?.content,
      done: assistant?.done
    }
  },

  /** Restore a payload that is not a usable database, through the production
   * import path. The live database must survive a rejected restore. */
  async importCorruptBackup(): Promise<{ error: string }> {
    const bytes = new TextEncoder().encode(
      "SQLite format 3 this is not a database".repeat(40)
    )
    try {
      await importDatabaseBytes(bytes)
      return { error: "" }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  },

  async exportInfo(): Promise<{ byteLength: number; magic: string }> {
    const bytes = await exportPersistedDatabaseBytes()
    return {
      byteLength: bytes.byteLength,
      magic: new TextDecoder().decode(bytes.slice(0, 15))
    }
  },

  reloadExtension(): void {
    browser.runtime.reload()
  }
}

declare global {
  interface Window {
    __persistenceVerify: typeof verifyApi
  }
}

window.__persistenceVerify = verifyApi
const statusLine = document.getElementById("status")
if (statusLine) statusLine.textContent = "hooks-ready"
