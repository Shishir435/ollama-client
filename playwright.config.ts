import { defineConfig } from "@playwright/test"

const chromiumProject = (
  name: string,
  testMatch: string,
  extensionBuildPath: string
) => ({
  name,
  testMatch,
  metadata: { extensionBuildPath }
})

export default defineConfig({
  testDir: "./e2e/chromium",
  outputDir: "artifacts/e2e/test-results",
  /**
   * One worker on one runner, measured rather than assumed. Two were tried:
   * the fourteen agent scenarios in a shard split evenly across both workers
   * and finished 1.96x faster than their summed duration — real parallelism —
   * while each test slowed from 6.7s to 13.2s under the contention of a
   * second browser, landing the shard within a second of where serial had it.
   * A scenario drives a browser, an extension worker and an offscreen
   * document, so two of them do not fit in four cores.
   *
   * Parallelism across runners is what buys anything here, and the workflow
   * shards three ways for it. `fullyParallel` stays off with the same
   * evidence, and the benchmark projects need it off regardless: they
   * accumulate attempts in a module-level array and assert its length before
   * writing the record, which only holds inside a single worker.
   */
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  reporter: [
    ["list"],
    ["html", { outputFolder: "artifacts/e2e/html", open: "never" }],
    /**
     * Per-test durations, retries included, written on every run. The HTML
     * report is only uploaded when something failed, which left a slow green
     * gate with nothing to read afterwards but the job's own total.
     */
    ["json", { outputFile: "artifacts/e2e/results.json" }]
  ],
  // The extension fixture launches its own persistent context so profiles can
  // survive full browser restarts. It therefore owns trace, screenshot, and
  // video capture instead of relying on Playwright's `use` context.
  projects: [
    {
      ...chromiumProject(
        "chromium-agent",
        "**/agent-*.spec.ts",
        "build/chrome-mv3-prod"
      ),
      metadata: {
        extensionBuildPath: "build/chrome-mv3-prod",
        agentObservationGrant: true
      }
    },
    {
      /**
       * Not in the `@critical` gate. It records what happened rather than
       * asserting a threshold, because the thresholds are meant to come from
       * a clean pass rather than be guessed before one exists.
       */
      ...chromiumProject(
        "chromium-agent-benchmark",
        "**/benchmark-agent.spec.ts",
        "build/chrome-mv3-prod"
      ),
      /**
       * Every task its own group, so `--shard` can divide them: they are all
       * declared in one spec file, and file-level grouping makes one group
       * that no shard can split. Workers stay at one, so a shard still runs
       * its tasks one at a time — what this buys is divisibility, not
       * concurrency.
       */
      fullyParallel: true,
      metadata: {
        extensionBuildPath: "build/chrome-mv3-prod",
        agentObservationGrant: true,
        agentBenchmarkBackend: "cdp"
      }
    },
    {
      /**
       * The same tasks with no debugger, which is the browser Firefox gives
       * us: `backend: "dom"`, every action through the content script. Two
       * passes over one suite are what makes "the native backend is better"
       * a measurement instead of a claim.
       */
      ...chromiumProject(
        "chromium-agent-benchmark-dom",
        "**/benchmark-agent.spec.ts",
        "build/chrome-mv3-prod"
      ),
      /**
       * Every task its own group, so `--shard` can divide them: they are all
       * declared in one spec file, and file-level grouping makes one group
       * that no shard can split. Workers stay at one, so a shard still runs
       * its tasks one at a time — what this buys is divisibility, not
       * concurrency.
       */
      fullyParallel: true,
      metadata: {
        extensionBuildPath: "build/chrome-mv3-prod",
        agentObservationGrant: true,
        agentDomBackend: true,
        agentBenchmarkBackend: "dom"
      }
    },
    chromiumProject(
      "chromium-production",
      "**/install-and-boot.spec.ts",
      "build/chrome-mv3-prod"
    ),
    chromiumProject(
      "chromium-persistence",
      "**/persistence.spec.ts",
      "build/chrome-mv3-benchmark"
    ),
    chromiumProject(
      "chromium-provider-streaming",
      "**/provider-streaming.spec.ts",
      "build/chrome-mv3-benchmark"
    )
  ]
})
