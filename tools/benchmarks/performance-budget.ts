export type PerformanceMeasurement = {
  p95Ms: number
}

export type PerformanceMeasurements = Record<string, PerformanceMeasurement>

export const PERFORMANCE_BUDGETS = {
  // These are intentionally broad local regression tripwires, not browser
  // latency targets. The benchmark processes 10,000 reducer events.
  streamReducer: { p95Ms: 20 },
  // The cache scenario prunes 1,000 stale entries down to its configured cap.
  searchCachePruning: { p95Ms: 2 }
} satisfies Record<string, PerformanceMeasurement>

export const performanceBudgetFailures = (
  measurements: PerformanceMeasurements,
  budgets: Record<string, PerformanceMeasurement> = PERFORMANCE_BUDGETS
): string[] =>
  Object.entries(budgets).flatMap(([name, budget]) => {
    const measurement = measurements[name]
    if (!measurement || !Number.isFinite(measurement.p95Ms)) {
      return [`${name} did not produce a finite p95 measurement`]
    }
    if (measurement.p95Ms < 0) {
      return [`${name} produced a negative p95 measurement`]
    }
    if (measurement.p95Ms > budget.p95Ms) {
      return [
        `${name} p95 ${measurement.p95Ms.toFixed(2)}ms exceeds ${budget.p95Ms}ms budget`
      ]
    }
    return []
  })
