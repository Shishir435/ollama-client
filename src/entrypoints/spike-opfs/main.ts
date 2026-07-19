import type { SqlJsStatic } from "sql.js"
import initSqlJs from "sql.js/dist/sql-wasm.js"
import {
  createFixture,
  SCALES,
  type ScaleName
} from "@/lib/sqlite/benchmark/persistence-benchmark-core"
import type {
  SpikeResponse,
  SpikeRunRequest,
  SpikeScaleResult
} from "@/spike/opfs/protocol"

const scaleSelect = document.getElementById("scale") as HTMLSelectElement
const iterationsInput = document.getElementById(
  "iterations"
) as HTMLInputElement
const runButton = document.getElementById("run") as HTMLButtonElement
const copyButton = document.getElementById("copy") as HTMLButtonElement
const cleanupButton = document.getElementById("cleanup") as HTMLButtonElement
const statusLine = document.getElementById("status") as HTMLParagraphElement
const warningLine = document.getElementById("warning") as HTMLParagraphElement
const output = document.getElementById("output") as HTMLPreElement

const setStatus = (message: string): void => {
  statusLine.textContent = message
}

const sampleMemoryBytes = (): number | null => {
  const memory = (
    performance as Performance & {
      memory?: { usedJSHeapSize?: number }
    }
  ).memory
  return typeof memory?.usedJSHeapSize === "number"
    ? memory.usedJSHeapSize
    : null
}

const toMiB = (bytes: number): number => bytes / (1024 * 1024)

let worker: Worker | undefined
let requestId = 0
const pending = new Map<
  number,
  { resolve: (response: SpikeResponse) => void }
>()

const getWorker = (): Worker => {
  if (!worker) {
    worker = new Worker(
      new URL("../../spike/opfs/sahpool-worker.ts", import.meta.url),
      { type: "module" }
    )
    worker.onmessage = (event: MessageEvent<SpikeResponse>) => {
      const entry = pending.get(event.data.id)
      if (!entry) return
      pending.delete(event.data.id)
      entry.resolve(event.data)
    }
    worker.onerror = (event) => {
      const error = `Worker error: ${event.message || "unknown"}`
      for (const [id, entry] of pending) {
        pending.delete(id)
        entry.resolve({ id, ok: false, error })
      }
    }
  }
  return worker
}

const callWorker = (
  request: Omit<SpikeRunRequest, "id"> | { type: "cleanup" },
  transfer: Transferable[] = []
): Promise<SpikeResponse> => {
  requestId += 1
  const id = requestId
  return new Promise((resolve) => {
    pending.set(id, { resolve })
    getWorker().postMessage({ ...request, id }, transfer)
  })
}

let sqlPromise: Promise<SqlJsStatic> | undefined

const initSql = (): Promise<SqlJsStatic> => {
  if (!sqlPromise) {
    sqlPromise = (async () => {
      const wasmUrl =
        globalThis.chrome?.runtime?.getURL?.("assets/sql-wasm.wasm") ??
        new URL("/assets/sql-wasm.wasm", location.origin).toString()
      const response = await fetch(wasmUrl)
      const wasmBinary = await response.arrayBuffer()
      return (
        initSqlJs as unknown as (config: {
          wasmBinary: Uint8Array
        }) => Promise<SqlJsStatic>
      )({ wasmBinary: new Uint8Array(wasmBinary) })
    })()
  }
  return sqlPromise
}

scaleSelect.addEventListener("change", () => {
  warningLine.hidden = scaleSelect.value !== "large"
})

runButton.addEventListener("click", async () => {
  const scaleName = scaleSelect.value as ScaleName
  const iterations = Number(iterationsInput.value)
  if (!Number.isInteger(iterations) || iterations < 1) {
    setStatus("Iterations must be a positive integer")
    return
  }

  runButton.disabled = true
  copyButton.disabled = true
  output.textContent = ""
  try {
    const memoryBefore = sampleMemoryBytes()
    setStatus("Loading sql.js WASM…")
    const SQL = await initSql()
    const scale = SCALES[scaleName]

    setStatus(`Building ${scaleName} fixture with sql.js…`)
    const buildStartedAt = performance.now()
    const fixture = createFixture(SQL, scale)
    const fixtureBuildMs = performance.now() - buildStartedAt

    setStatus("Exporting fixture bytes…")
    const exportStartedAt = performance.now()
    const fixtureBytes = fixture.export()
    const initialExportMs = performance.now() - exportStartedAt
    fixture.close()

    setStatus(
      `Importing ${toMiB(fixtureBytes.byteLength).toFixed(1)} MiB into opfs-sahpool and measuring…`
    )
    const buffer = fixtureBytes.buffer.slice(
      fixtureBytes.byteOffset,
      fixtureBytes.byteOffset + fixtureBytes.byteLength
    ) as ArrayBuffer
    const response = await callWorker(
      {
        type: "run",
        scaleName,
        iterations,
        expectedSessions: scale.chats,
        expectedMessages: scale.messages,
        hasTree: Boolean(scale.tree),
        bytes: buffer
      },
      [buffer]
    )
    if (!response.ok) throw new Error(response.error)
    if (!response.result) throw new Error("Worker returned no result")

    const memoryAfter = sampleMemoryBytes()
    const result: SpikeScaleResult = {
      scale: scaleName,
      chats: scale.chats,
      messages: scale.messages,
      iterations,
      fixtureMiB: toMiB(fixtureBytes.byteLength),
      fixtureBuildMs,
      initialExportMs,
      ...(scale.tree ? { treePlan: scale.tree } : {}),
      ...response.result,
      memoryDeltaMiB:
        memoryBefore !== null && memoryAfter !== null
          ? toMiB(memoryAfter - memoryBefore)
          : null,
      memoryMetric: memoryBefore === null ? null : "page-usedJSHeapSize"
    }

    output.textContent = JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
        topology:
          "sqlite-wasm opfs-sahpool in one dedicated worker; incremental transactional writes",
        results: [result]
      },
      null,
      2
    )
    copyButton.disabled = false
    setStatus("Done")
  } catch (error) {
    setStatus(`Failed: ${error instanceof Error ? error.message : error}`)
  } finally {
    runButton.disabled = false
  }
})

copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(output.textContent ?? "")
  setStatus("Copied")
})

cleanupButton.addEventListener("click", async () => {
  cleanupButton.disabled = true
  try {
    const response = await callWorker({ type: "cleanup" })
    if (!response.ok) throw new Error(response.error)
    setStatus("Benchmark databases deleted")
  } catch (error) {
    setStatus(
      `Cleanup failed: ${error instanceof Error ? error.message : error}`
    )
  } finally {
    cleanupButton.disabled = false
  }
})
