/**
 * What the suite declares it will run, with nothing else in the module.
 *
 * It sits apart from the tasks so the merge can read it without loading them.
 * `benchmark-tasks.ts` pulls in the scenario fixture and, through it,
 * Playwright; the merge only needs two numbers, and importing them through
 * that file would make a one-second join depend on an installed test runner.
 */

export const benchmarkAttempts = Math.max(
  1,
  Number.parseInt(process.env.AGENT_BENCHMARK_ATTEMPTS ?? "1", 10) || 1
)

/** Frozen: what the suite declares, plus the report task that closes it. */
export const benchmarkTaskCount = 30

export const benchmarkExpectedAttempts =
  (benchmarkTaskCount + 1) * benchmarkAttempts
