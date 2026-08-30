import {
  makeStreamReducerState,
  reduceStreamEvent
} from "../packages/runtime-core/src/chat-stream-reducer"
import {
  pruneSearchCache,
  type SearchCacheEntry
} from "../src/lib/embeddings/cache-pruning"

type Measurement = {
  medianMs: number
  p95Ms: number
  samples: number[]
}

const measure = (
  run: () => void,
  iterations = 15,
  prepare?: () => void
): Measurement => {
  const samples: number[] = []
  for (let iteration = 0; iteration < iterations; iteration++) {
    prepare?.()
    const started = performance.now()
    run()
    samples.push(performance.now() - started)
  }
  samples.sort((a, b) => a - b)
  return {
    medianMs: samples[Math.floor(samples.length / 2)],
    p95Ms: samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)],
    samples
  }
}

const benchmarkStreamReducer = (): Measurement => {
  const events = Array.from({ length: 10_000 }, (_, index) => ({
    type: "token",
    seq: index,
    delta: "x"
  }))
  return measure(() => {
    let state = makeStreamReducerState({ content: "" })
    for (const event of events) {
      state = reduceStreamEvent(state, event).state
    }
  })
}

const benchmarkSearchCachePruning = (): Measurement => {
  const now = 1_000_000
  const cache = new Map<string, SearchCacheEntry>()
  return measure(() => {
    pruneSearchCache(cache, now, 5_000, 50)
  }, 15, () => {
    cache.clear()
    // Insert oldest first to model the cache's insertion-order LRU policy.
    for (let index = 999; index >= 0; index--) {
      cache.set(`query-${index}`, {
        results: [],
        timestamp: now - index * 10
      })
    }
  })
}

const batchDelayScenarios = [
  { items: 100, batchSize: 5, delayMs: 100 },
  { items: 100, batchSize: 10, delayMs: 100 },
  { items: 100, batchSize: 5, delayMs: 0 }
].map((scenario) => ({
  ...scenario,
  interBatchWaitMs:
    Math.max(0, Math.ceil(scenario.items / scenario.batchSize) - 1) *
    scenario.delayMs
}))

console.log(
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      runtime: process.version,
      notes: [
        "Reducer and cache measurements are local CPU timings, not user telemetry.",
        "Batch scenarios report configured inter-batch wait only; provider/network latency must be measured separately.",
        "Search cache is intentionally not rehydrated because no durable vector-generation invalidation contract exists yet."
      ],
      measurements: {
        streamReducer: benchmarkStreamReducer(),
        searchCachePruning: benchmarkSearchCachePruning(),
        embeddingBatchDelay: batchDelayScenarios
      }
    },
    null,
    2
  )
)
