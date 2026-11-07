import assert from "node:assert/strict"
import { test } from "node:test"
import {
  PERFORMANCE_BUDGETS,
  performanceBudgetFailures
} from "../performance-budget.ts"

test("accepts measurements at and below the p95 budgets", () => {
  assert.deepEqual(
    performanceBudgetFailures({
      streamReducer: { p95Ms: PERFORMANCE_BUDGETS.streamReducer.p95Ms },
      searchCachePruning: { p95Ms: 1 }
    }),
    []
  )
})

test("reports a metric that exceeds its p95 budget", () => {
  assert.deepEqual(
    performanceBudgetFailures({
      streamReducer: { p95Ms: 20.1 },
      searchCachePruning: { p95Ms: 1 }
    }),
    ["streamReducer p95 20.10ms exceeds 20ms budget"]
  )
})

test("rejects missing and invalid measurements", () => {
  assert.deepEqual(
    performanceBudgetFailures({
      streamReducer: { p95Ms: Number.NaN }
    }),
    [
      "streamReducer did not produce a finite p95 measurement",
      "searchCachePruning did not produce a finite p95 measurement"
    ]
  )
})
