import { createRequire } from "node:module"
import { indexedDB } from "fake-indexeddb"
import initSqlJs, { type SqlJsStatic } from "sql.js"
import {
  SCALE_NAMES,
  type ScaleName,
  runScale
} from "../src/lib/sqlite/benchmark/persistence-benchmark-core"

const require = createRequire(import.meta.url)
const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm")

const main = async (): Promise<void> => {
  const scaleArgument =
    process.argv
      .find((argument) => argument.startsWith("--scale="))
      ?.split("=")[1] ?? "small"
  const iterations = Number(
    process.argv
      .find((argument) => argument.startsWith("--iterations="))
      ?.split("=")[1] ?? 5
  )

  if (
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    !["all", ...SCALE_NAMES].includes(scaleArgument)
  ) {
    throw new Error(
      `Usage: pnpm benchmark:persistence --scale=${SCALE_NAMES.join("|")}|all --iterations=N`
    )
  }

  const SQL: SqlJsStatic = await initSqlJs({ locateFile: () => wasmPath })
  const scaleNames: ScaleName[] =
    scaleArgument === "all" ? SCALE_NAMES : [scaleArgument as ScaleName]
  const results = []
  for (const scaleName of scaleNames) {
    results.push(
      await runScale(SQL, scaleName, iterations, {
        indexedDB,
        sampleMemoryBytes: () => process.memoryUsage().rss,
        memoryMetric: "process-rss"
      })
    )
  }

  console.log(
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        runtime: process.version,
        topology: "sql.js full export persisted as one IndexedDB value",
        results
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
