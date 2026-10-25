export const MINIMUM_BASELINE_RUNS = 20

export const REGRESSION_METRICS = [
  "firstContentfulPaintMs",
  "appMountMs",
  "chatTimeToFirstTokenMs",
  "chatCompletionMs"
] as const

export type RegressionMetric = (typeof REGRESSION_METRICS)[number]
export type PerformanceEnvironment = {
  browserMajor: string
  nodeMajor: string
  project: string
  runnerOS: string
}
export type ExtensionPerformanceReport = {
  schemaVersion: 1
  measuredAt: string
  browser: { major: string; project: string; userAgent: string }
  runner: {
    arch: string
    commitSha: string
    nodeMajor: string
    os: string
    workflowRunId: string
  }
  sampleCount: number
  metrics: Record<RegressionMetric, number>
  samples: Array<Record<string, unknown>>
}
export type PerformanceBaseline = {
  schemaVersion: 1
  generatedAt: string
  sourceRunCount: number
  environment: PerformanceEnvironment
  metrics: Record<RegressionMetric, { medianMs: number; madMs: number }>
}

export const parsePerformanceBaseline = (
  input: unknown
): PerformanceBaseline => {
  if (!input || typeof input !== "object") {
    throw new Error("Performance baseline must be a JSON object")
  }
  const baseline = input as Partial<PerformanceBaseline>
  if (
    baseline.schemaVersion !== 1 ||
    typeof baseline.generatedAt !== "string" ||
    typeof baseline.sourceRunCount !== "number" ||
    baseline.sourceRunCount < MINIMUM_BASELINE_RUNS ||
    !baseline.environment ||
    !baseline.metrics
  ) {
    throw new Error(
      "Performance baseline is incomplete or has an unsupported schema"
    )
  }
  for (const key of [
    "browserMajor",
    "nodeMajor",
    "project",
    "runnerOS"
  ] as const) {
    if (typeof baseline.environment[key] !== "string") {
      throw new Error(`Performance baseline is missing environment.${key}`)
    }
  }
  for (const name of REGRESSION_METRICS) {
    const metric = baseline.metrics[name]
    if (
      !metric ||
      !Number.isFinite(metric.medianMs) ||
      !Number.isFinite(metric.madMs) ||
      metric.medianMs < 0 ||
      metric.madMs < 0
    ) {
      throw new Error(`Performance baseline has an invalid ${name} metric`)
    }
  }
  return baseline as PerformanceBaseline
}

export const median = (values: number[]): number => {
  if (values.length === 0) throw new Error("Cannot calculate an empty median")
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

const reportEnvironment = (
  report: ExtensionPerformanceReport
): PerformanceEnvironment => ({
  browserMajor: report.browser.major,
  nodeMajor: report.runner.nodeMajor,
  project: report.browser.project,
  runnerOS: report.runner.os
})

const sameEnvironment = (
  left: PerformanceEnvironment,
  right: PerformanceEnvironment
): boolean =>
  left.browserMajor === right.browserMajor &&
  left.nodeMajor === right.nodeMajor &&
  left.project === right.project &&
  left.runnerOS === right.runnerOS

export const compareWithBaseline = (
  report: ExtensionPerformanceReport,
  baseline: PerformanceBaseline | null
): { mode: "gated" | "report-only"; notes: string[]; failures: string[] } => {
  if (!baseline) {
    return {
      mode: "report-only",
      notes: ["No committed CI baseline yet; collecting reports."],
      failures: []
    }
  }
  if (!sameEnvironment(reportEnvironment(report), baseline.environment)) {
    return {
      mode: "report-only",
      notes: ["CI baseline environment differs; collect a matching baseline."],
      failures: []
    }
  }

  const failures = REGRESSION_METRICS.flatMap((name) => {
    const value = report.metrics[name]
    const prior = baseline.metrics[name]
    if (
      !Number.isFinite(value) ||
      !prior ||
      !Number.isFinite(prior.medianMs) ||
      !Number.isFinite(prior.madMs) ||
      prior.medianMs < 0 ||
      prior.madMs < 0
    ) {
      return [
        `${name} is missing or invalid in the performance baseline/report`
      ]
    }
    // Three MADs reduce noise sensitivity; the 20% floor avoids failing on
    // small machine-to-machine changes. A 25ms floor avoids overreacting near zero.
    const allowanceMs = Math.max(25, prior.medianMs * 0.2, prior.madMs * 3)
    const limitMs = prior.medianMs + allowanceMs
    return value > limitMs
      ? [
          `${name} ${value.toFixed(1)}ms exceeds ${limitMs.toFixed(1)}ms baseline limit`
        ]
      : []
  })
  return { mode: "gated", notes: [], failures }
}

export const buildPerformanceBaseline = (
  reports: ExtensionPerformanceReport[],
  generatedAt = new Date().toISOString()
): PerformanceBaseline => {
  const uniqueRuns = new Map<string, ExtensionPerformanceReport>()
  for (const report of reports) {
    if (report.schemaVersion !== 1 || report.sampleCount < 3) {
      throw new Error(
        "Baseline reports must be schema v1 with at least 3 samples"
      )
    }
    const runId = report.runner.workflowRunId
    if (!runId)
      throw new Error("Baseline input must come from a GitHub Actions run")
    uniqueRuns.set(runId, report)
  }
  if (uniqueRuns.size < MINIMUM_BASELINE_RUNS) {
    throw new Error(
      `Need ${MINIMUM_BASELINE_RUNS} distinct CI runs; found ${uniqueRuns.size}`
    )
  }

  const distinct = [...uniqueRuns.values()]
  const environment = reportEnvironment(distinct[0])
  if (
    distinct.some(
      (report) => !sameEnvironment(environment, reportEnvironment(report))
    )
  ) {
    throw new Error(
      "Baseline reports span different browser/runner environments"
    )
  }

  const metrics = Object.fromEntries(
    REGRESSION_METRICS.map((name) => {
      const runValues = distinct.map((report) => {
        const value = report.metrics[name]
        if (!Number.isFinite(value) || value < 0) {
          throw new Error(`Invalid ${name} measurement in CI report`)
        }
        return value
      })
      const center = median(runValues)
      return [
        name,
        {
          medianMs: center,
          madMs: median(runValues.map((value) => Math.abs(value - center)))
        }
      ]
    })
  ) as PerformanceBaseline["metrics"]

  return {
    schemaVersion: 1,
    generatedAt,
    sourceRunCount: uniqueRuns.size,
    environment,
    metrics
  }
}

export const extractPerformanceReports = (
  input: unknown
): ExtensionPerformanceReport[] => {
  const reports: ExtensionPerformanceReport[] = []
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return
    if (Array.isArray(value)) {
      for (const child of value) visit(child)
      return
    }
    const record = value as Record<string, unknown>
    if (Array.isArray(record.annotations)) {
      for (const annotation of record.annotations) {
        if (!annotation || typeof annotation !== "object") continue
        const candidate = annotation as {
          type?: unknown
          description?: unknown
        }
        if (
          candidate.type !== "extension-performance" ||
          typeof candidate.description !== "string"
        )
          continue
        const parsed = JSON.parse(
          candidate.description
        ) as ExtensionPerformanceReport
        if (parsed.schemaVersion === 1) reports.push(parsed)
      }
    }
    for (const child of Object.values(record)) visit(child)
  }
  visit(input)
  return reports
}
