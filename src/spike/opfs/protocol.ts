import type {
  SampleSummary,
  ScaleName,
  TreePlan
} from "@/lib/sqlite/benchmark/persistence-benchmark-core"

// Section 9.4 spike wire types between the spike page and the dedicated
// sqlite-wasm opfs-sahpool worker. Throwaway spike code: keep it isolated
// from production modules.

export interface SpikeRunRequest {
  id: number
  type: "run"
  scaleName: ScaleName
  iterations: number
  expectedSessions: number
  expectedMessages: number
  hasTree: boolean
  // sql.js-exported database bytes; transferred, not copied.
  bytes: ArrayBuffer
}

export interface SpikeCleanupRequest {
  id: number
  type: "cleanup"
}

export type SpikeRequest = SpikeRunRequest | SpikeCleanupRequest

export interface SpikeWorkerResult {
  importDbMs: number
  importedBytes: number
  rowCountsOk: boolean
  journalMode: string
  coldOpenMs: SampleSummary
  first50SessionsMs: SampleSummary
  warm50MessagesMs: SampleSummary
  activePath50Ms?: SampleSummary
  durableAppendMs: SampleSummary
  checkpointChurn20Ms: SampleSummary
}

export interface SpikeScaleResult extends SpikeWorkerResult {
  scale: ScaleName
  chats: number
  messages: number
  iterations: number
  fixtureMiB: number
  fixtureBuildMs: number
  initialExportMs: number
  treePlan?: TreePlan
  memoryDeltaMiB: number | null
  memoryMetric: string | null
}

export type SpikeResponse =
  | { id: number; ok: true; result?: SpikeWorkerResult }
  | { id: number; ok: false; error: string }
