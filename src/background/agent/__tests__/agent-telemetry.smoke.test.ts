import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { createAgentController } from "@ollama-client/agent-runtime"
import type { AgentObservation } from "@ollama-client/contracts"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest"

import { SQLITE_DB_KEY, SQLITE_DB_NAME, SQLITE_DB_STORE } from "@/lib/constants"
import { createChatDbEngine } from "@/lib/persistence/chat-db-engine"
import type { LLMProvider } from "@/lib/providers/types"
import { ProviderType } from "@/lib/providers/types"

/**
 * Starting a run against the real engine.
 *
 * Every piece below the service is already covered in isolation, and the
 * failure this catches is the one none of those see: the service reads and
 * writes durable rows before any provider work, so a start that throws there
 * reaches the panel as an unexplained refusal with no network call to show
 * for it.
 */

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

const installOwner = () => {
  const engine = createChatDbEngine({ wasmBinary: Promise.resolve(wasmBuffer) })
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

afterEach(() => {
  globalThis.__persistenceHostCall = undefined
})

describe("Agent step telemetry against the real engine", () => {
  it(
    "writes what a step cost onto its durable receipt",
    async () => {
      vi.resetModules()
      installOwner()
      const [{ createAgentRunService }, modelModule, repository] =
        await Promise.all([
          import("../agent-run-service"),
          import("@/application/agent/agent-model-port"),
          import("@/lib/repositories/agent-runs")
        ])

      const observationAt = (generation: number): AgentObservation => ({
        snapshotId: `snapshot-telemetry-${generation}`,
        generation,
        tabId: 7,
        frameId: 0,
        documentId: "document-telemetry-1",
        url: "https://example.com/start",
        origin: "https://example.com",
        title: "Example",
        frames: [
          {
            frameId: 0,
            documentId: "document-telemetry-1",
            origin: "https://example.com",
            url: "https://example.com/start",
            access: "ok",
            snapshotId: `snapshot-telemetry-${generation}`,
            generation
          }
        ],
        elements: [],
        visibleText: "Example",
        scroll: {
          x: 0,
          y: 0,
          viewportWidth: 800,
          viewportHeight: 600,
          documentWidth: 800,
          documentHeight: 600
        },
        dialogs: [],
        capturedAt: 1_700_000_000_000
      })
      const observation = observationAt(1)
      let generation = 0

      const decisions = [
        { type: "read" },
        { type: "complete", summary: "Read the page." }
      ]
      const provider = {
        id: "ollama",
        config: {
          id: "ollama",
          type: ProviderType.OLLAMA,
          enabled: true,
          name: "Ollama"
        },
        capabilities: {
          chat: true,
          embeddings: true,
          modelDiscovery: true,
          modelDetails: true,
          modelPull: true,
          modelUnload: true,
          modelDelete: true,
          providerVersion: true,
          toolCalling: true
        },
        async streamChat(_request, emit) {
          emit({
            toolCalls: [
              {
                id: `call-${decisions.length}`,
                name: "agent_decision",
                arguments: decisions.shift() ?? {
                  type: "complete",
                  summary: "Read the page."
                }
              }
            ],
            done: true,
            metrics: { prompt_eval_count: 4_242, eval_count: 77 }
          })
        },
        getModels: async () => []
      } satisfies LLMProvider

      /** Advances so a phase measures something a constant clock could not. */
      let tick = 1_700_000_000_000
      const service = createAgentRunService({
        hasPerception: async () => true,
        getTab: async () => ({ url: observation.url }),
        classifyAccess: async () => "ok",
        now: () => (tick += 5),
        newRunId: () => "run-telemetry-1",
        buildController: ({ persistence, now }) =>
          createAgentController({
            persistence,
            model: modelModule.createProviderAgentModelPort({
              resolveProvider: async () => provider,
              resolveCompatibility: async () => ({
                status: "supported",
                mode: "native",
                reason: "metadata"
              })
            }),
            observation: {
              observe: async () => {
                generation += 1
                return observationAt(generation)
              }
            },
            effect: {
              resolve: async (command, current) => ({
                command,
                target: { sensitive: false, maySubmit: false },
                semanticEffects: ["read"],
                snapshotIdentity: {
                  snapshotId: current.snapshotId,
                  generation: current.generation,
                  tabId: current.tabId,
                  frameId: current.frameId,
                  documentId: current.documentId
                },
                sourceUrl: current.url,
                sourceOrigin: current.origin
              }),
              execute: async () => ({ executedAt: now() }),
              verify: async () => ({
                outcome: "confirmed" as const,
                evidence: {
                  kind: "read" as const,
                  summary: "ok",
                  observedAt: now()
                }
              })
            },
            policy: { evaluate: () => ({ type: "allow", risk: "low" }) },
            approval: { request: async () => ({ type: "approved" }) },
            takeover: { request: async () => ({ type: "takeover_started" }) },
            clock: { now }
          })
      })

      await service.start({
        goal: "Read the page",
        tabId: 7,
        providerId: "ollama",
        modelId: "qwen3"
      })

      await vi.waitFor(async () => {
        const snapshot = await service.snapshot("run-telemetry-1")
        expect(["completed", "failed"]).toContain(snapshot.run?.status)
      })
      const settled = await service.snapshot("run-telemetry-1")
      expect({
        status: settled.run?.status,
        error: settled.run?.error
      }).toEqual({ status: "completed", error: undefined })

      const steps = await repository.listAgentSteps("run-telemetry-1")
      const measured = steps.filter((step) => step.telemetry !== undefined)
      expect(measured.length).toBeGreaterThan(0)

      const last = measured[measured.length - 1]
      /** Timed by the controller. */
      expect(last.telemetry?.observations).toBeGreaterThanOrEqual(1)
      /** Reported by the provider and claimed from the model port. */
      expect(last.telemetry?.promptTokens).toBe(4_242)
      expect(last.telemetry?.outputTokens).toBe(77)
      /** Estimated separately, so it can never be read as the measurement. */
      expect(last.telemetry?.promptTokensEstimated).toBeGreaterThan(0)
    },
    TIMEOUT
  )
})
