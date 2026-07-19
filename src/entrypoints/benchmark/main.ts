import type { SqlJsStatic } from "sql.js"
import initSqlJs from "sql.js/dist/sql-wasm.js"
import {
  deleteBenchmarkStore,
  runScale,
  SCALE_NAMES,
  type ScaleName
} from "@/lib/sqlite/benchmark/persistence-benchmark-core"

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

const storageEstimate = async (): Promise<{
  usageMiB: number | null
  quotaMiB: number | null
}> => {
  if (!navigator.storage?.estimate) return { usageMiB: null, quotaMiB: null }
  const estimate = await navigator.storage.estimate()
  const toMiB = (bytes: number | undefined) =>
    typeof bytes === "number" ? bytes / (1024 * 1024) : null
  return { usageMiB: toMiB(estimate.usage), quotaMiB: toMiB(estimate.quota) }
}

let sqlPromise: Promise<SqlJsStatic> | undefined

const initSql = (): Promise<SqlJsStatic> => {
  if (!sqlPromise) {
    sqlPromise = (async () => {
      const wasmUrl = chrome.runtime.getURL("assets/sql-wasm.wasm")
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
    setStatus("Loading sql.js WASM…")
    const SQL = await initSql()
    const storageBefore = await storageEstimate()
    const result = await runScale(
      SQL,
      scaleName,
      iterations,
      {
        indexedDB,
        sampleMemoryBytes,
        memoryMetric: sampleMemoryBytes() === null ? null : "usedJSHeapSize"
      },
      setStatus
    )
    const storageAfter = await storageEstimate()
    output.textContent = JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
        topology: "sql.js full export persisted as one IndexedDB value",
        storageBefore,
        storageAfter,
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
    for (const scaleName of SCALE_NAMES) {
      await deleteBenchmarkStore(indexedDB, scaleName)
    }
    setStatus("Benchmark databases deleted")
  } catch (error) {
    setStatus(
      `Cleanup failed: ${error instanceof Error ? error.message : error}`
    )
  } finally {
    cleanupButton.disabled = false
  }
})
