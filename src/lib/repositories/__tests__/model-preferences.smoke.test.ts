import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest"
import {
  DEFAULT_MODEL_CONFIG,
  SQLITE_DB_KEY,
  SQLITE_DB_NAME,
  SQLITE_DB_STORE,
  STORAGE_KEYS
} from "@/lib/constants"
import { createChatDbEngine } from "@/lib/persistence/chat-db-engine"

/**
 * Per-model preferences against the real engine: the sync import, the
 * compaction of configs, read-modify-write, prefix deletion and the legacy
 * bare-key fallback. The sync area is the only thing faked.
 */

const sync = vi.hoisted(() => new Map<string, unknown>())
vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: async (key: string) => sync.get(key),
  removePlasmoStoredValue: async (key: string) => {
    sync.delete(key)
  },
  setPlasmoStoredValue: async (key: string, value: unknown) => {
    sync.set(key, value)
  }
}))

const TIMEOUT = 25_000

const require = createRequire(import.meta.url)
const wasmPath = require.resolve("@sqlite.org/sqlite-wasm/sqlite3.wasm")
let wasmBuffer: ArrayBuffer

beforeAll(() => {
  const wasm = readFileSync(wasmPath)
  wasmBuffer = wasm.buffer.slice(
    wasm.byteOffset,
    wasm.byteOffset + wasm.byteLength
  )
})

let owner: ReturnType<typeof createChatDbEngine> | undefined

/** Stand in for the database owner; see chat-durability.smoke.test.ts. */
const installOwner = () => {
  const engine = createChatDbEngine({ wasmBinary: Promise.resolve(wasmBuffer) })
  owner = engine
  const ready = engine.submit({ op: "setBackend", backend: "legacy" })
  globalThis.__persistenceHostCall = async (request) => {
    await ready
    return engine.submit(request)
  }
}

const clearSqliteStore = (): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(SQLITE_DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SQLITE_DB_STORE)) {
        db.createObjectStore(SQLITE_DB_STORE)
      }
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SQLITE_DB_STORE)) {
        db.close()
        resolve()
        return
      }
      const tx = db.transaction([SQLITE_DB_STORE], "readwrite")
      tx.objectStore(SQLITE_DB_STORE).delete(SQLITE_DB_KEY)
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => {
        db.close()
        reject(tx.error)
      }
    }
  })

beforeEach(async () => {
  await clearSqliteStore()
}, TIMEOUT)

afterEach(async () => {
  try {
    // Drain the legacy debounce before the next test deletes the stored image.
    // Otherwise this owner can restore its old sessions after that deletion.
    await owner?.submit({ op: "flush" })
  } finally {
    owner = undefined
    globalThis.__persistenceHostCall = undefined
  }
}, TIMEOUT)

const boot = async () => {
  vi.resetModules()
  installOwner()
  const preferences = await import("../model-preferences")
  const configs = await import("../model-configs")
  return { ...preferences, ...configs }
}

beforeEach(() => {
  sync.clear()
})

describe("model preferences", () => {
  it(
    "imports the sync map without the defaults and removes the sync key",
    async () => {
      sync.set(
        STORAGE_KEYS.PROVIDER.MODEL_CONFIGS,
        JSON.stringify({
          "codex::gpt": {
            ...DEFAULT_MODEL_CONFIG,
            num_predict: 18192,
            reasoning_effort: "low"
          },
          "ollama::plain": { ...DEFAULT_MODEL_CONFIG }
        })
      )
      const repo = await boot()

      expect(await repo.listModelPreferences("config")).toEqual({
        "codex::gpt": { num_predict: 18192, reasoning_effort: "low" },
        "ollama::plain": {}
      })
      expect(sync.has(STORAGE_KEYS.PROVIDER.MODEL_CONFIGS)).toBe(false)
      expect((await repo.getResolvedModelConfig("gpt", "codex")).system).toBe(
        DEFAULT_MODEL_CONFIG.system
      )
    },
    TIMEOUT
  )

  it(
    "keeps the sync copy when an entry fails validation",
    async () => {
      sync.set(STORAGE_KEYS.PROVIDER.MODEL_CAPABILITY_OVERRIDES, {
        "a::m": { vision: true },
        "b::m": { vision: "yes" }
      })
      const repo = await boot()

      expect(await repo.listModelPreferences("capabilities")).toEqual({
        "a::m": { vision: true }
      })
      /** Only the refused entry stays, so a deleted one cannot come back. */
      expect(
        sync.get(STORAGE_KEYS.PROVIDER.MODEL_CAPABILITY_OVERRIDES)
      ).toEqual({ "b::m": { vision: "yes" } })
    },
    TIMEOUT
  )

  it(
    "updates, deletes, and deletes by a literal prefix",
    async () => {
      const repo = await boot()
      await repo.updateModelPreference<{ enabled?: boolean }>(
        "tools",
        "p_1::m",
        () => ({ enabled: true })
      )
      await repo.updateModelPreference<{ enabled?: boolean }>(
        "tools",
        "px1::m",
        () => ({ enabled: false })
      )
      await repo.updateModelPreference<{ enabled?: boolean }>(
        "tools",
        "p_1::m",
        (current) => ({ ...current, enabled: !current?.enabled })
      )
      expect(await repo.getModelPreferences("tools", ["p_1::m"])).toEqual({
        "p_1::m": { enabled: false }
      })

      /** `_` is a LIKE wildcard; it must not match "px1". */
      await repo.deleteModelPreferencesWithPrefix("tools", "p_1::")
      expect(await repo.listModelPreferences("tools")).toEqual({
        "px1::m": { enabled: false }
      })

      await repo.updateModelPreference("tools", "px1::m", () => null)
      expect(await repo.listModelPreferences("tools")).toEqual({})
    },
    TIMEOUT
  )

  it(
    "falls back to a bare legacy entry without its effort, and promotes it on edit",
    async () => {
      sync.set(STORAGE_KEYS.PROVIDER.MODEL_CONFIGS, {
        gpt: { num_ctx: 4096, reasoning_effort: "high" }
      })
      const repo = await boot()

      expect(await repo.getStoredModelConfigFor("gpt", "codex")).toEqual({
        num_ctx: 4096
      })

      await repo.updateModelConfig("gpt", "codex", { reasoning_effort: "low" })
      expect(await repo.getModelPreferences("config", ["codex::gpt"])).toEqual({
        "codex::gpt": { num_ctx: 4096, reasoning_effort: "low" }
      })
    },
    TIMEOUT
  )

  it(
    "survives a chat-database reset through snapshot and restore, and clears by kind",
    async () => {
      const repo = await boot()
      const { resetSQLiteDatabase } = await import("@/lib/sqlite/db")
      await repo.updateModelConfig("gpt", "codex", { num_ctx: 8192 })
      await repo.updateModelPreference("capabilities", "codex::gpt", () => ({
        vision: true
      }))
      await repo.updateModelPreference("tools", "codex::gpt", () => ({
        enabled: false
      }))

      const kept = await repo.snapshotModelPreferenceRows()
      await resetSQLiteDatabase()
      expect(await repo.snapshotModelPreferenceRows()).toEqual([])
      await repo.restoreModelPreferenceRows(kept)
      expect(await repo.getStoredModelConfigFor("gpt", "codex")).toEqual({
        num_ctx: 8192
      })

      await repo.clearModelPreferences(["config", "capabilities"])
      expect(await repo.listModelPreferences("config")).toEqual({})
      expect(await repo.listModelPreferences("capabilities")).toEqual({})
      expect(await repo.listModelPreferences("tools")).toEqual({
        "codex::gpt": { enabled: false }
      })
    },
    TIMEOUT
  )

  it(
    "imports a sync map written after this context already imported",
    async () => {
      const addListener = vi.mocked(chrome.storage.onChanged.addListener)
      addListener.mockClear()
      const repo = await boot()
      expect(await repo.listModelPreferences("capabilities")).toEqual({})
      const onChanged = addListener.mock.calls.at(-1)?.[0]
      expect(onChanged).toBeTypeOf("function")

      const notified: string[] = []
      repo.subscribeModelPreferences((kind) => notified.push(kind))
      const key = STORAGE_KEYS.PROVIDER.MODEL_CAPABILITY_OVERRIDES
      const value = JSON.stringify({ "custom:x::m": { toolCalling: true } })
      sync.set(key, value)
      onChanged?.({ [key]: { newValue: value } }, "sync")

      expect(notified).toEqual(["capabilities"])
      expect(await repo.listModelPreferences("capabilities")).toEqual({
        "custom:x::m": { toolCalling: true }
      })
      expect(sync.has(key)).toBe(false)

      /** The import's own removal must not re-arm it. */
      onChanged?.({ [key]: { oldValue: value } }, "sync")
      expect(notified).toEqual(["capabilities"])
    },
    TIMEOUT
  )
})
