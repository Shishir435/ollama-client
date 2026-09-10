#!/usr/bin/env node

/**
 * Agent recovery after a real MV3 service-worker death.
 *
 * The unit smoke test drives recovery through the real SQLite engine, which
 * proves the SQL settles a run that is already in the interrupted state. It
 * cannot prove a terminated worker reaches that state, or that the fresh one
 * settles it without running any Agent work — and "restart after an uncertain
 * submission pauses without resubmitting" is a claim about exactly that.
 *
 * So: a run is left durably `executing` with its step open, the worker is
 * killed through DevTools while the extension page and the offscreen SQLite
 * owner keep running, and the replacement worker's own startup recovery is
 * what has to settle it. The step must end `uncertain` and the run `paused`
 * for an unresolved effect, with no new step — a second receipt would mean
 * the effect had been reissued, which is the failure this gate exists for.
 *
 * Usage: pnpm verify:sw-agent-recovery
 * Requires: pnpm benchmark:build
 */

import { resolve } from "node:path"

import {
  type GateResult,
  gateRecorder,
  poll,
  reportGates,
  verifyCall,
  withExtensionHarness
} from "./lib/chromium-extension-harness"

const buildPath = resolve("build/chrome-mv3-benchmark")
const artifactDir = resolve("artifacts/e2e")

interface AgentOutcome {
  status?: string
  pauseReason?: string
  stepStatuses: string[]
  stepIds: string[]
}

const results: GateResult[] = []
const record = gateRecorder(results)

const run = async (): Promise<void> => {
  await withExtensionHarness({
    buildPath,
    page: "persistence-verify.html",
    async body({
      page,
      originalWorker,
      listTargets,
      findServiceWorker,
      httpJson
    }) {
      const runId = "verify-agent-sw-loss"
      await page.evaluate(verifyCall("seedInterruptedAgentRun", runId))
      const seeded = await page.evaluate<AgentOutcome>(
        verifyCall("agentRunOutcome", runId)
      )
      record(
        "agent-run-interrupted",
        seeded.status === "executing" &&
          seeded.stepStatuses.at(-1) === "executing",
        { seeded }
      )

      const closeResult = await httpJson(`/json/close/${originalWorker.id}`)
      const workerGone = await poll(
        async () =>
          !(await listTargets()).some(
            (target) => target.id === originalWorker.id
          ),
        Boolean,
        "original service-worker termination"
      )
      record("agent-sw-terminated", workerGone, {
        originalWorkerId: originalWorker.id,
        closeResult
      })

      /**
       * Nothing here resumes the run. The page asks the database a question,
       * which is enough to wake a worker; whatever that worker does to the
       * run has to be its own startup recovery.
       */
      const settled = await poll(
        () => page.evaluate<AgentOutcome>(verifyCall("agentRunOutcome", runId)),
        (outcome) => outcome.status === "paused",
        "agent run settled by the replacement worker",
        45_000
      )
      const replacementWorker = await poll(
        async () => findServiceWorker(await listTargets()),
        (target) => Boolean(target && target.id !== originalWorker.id),
        "replacement service worker"
      )

      record(
        "agent-run-paused-unresolved",
        settled.status === "paused" &&
          settled.pauseReason === "unresolved_effect",
        { settled }
      )
      record(
        "agent-effect-not-reissued",
        settled.stepIds.length === seeded.stepIds.length &&
          settled.stepStatuses.at(-1) === "uncertain",
        {
          before: seeded.stepStatuses,
          after: settled.stepStatuses,
          replacementWorkerId: replacementWorker?.id
        }
      )

      /** The settled state is durable, not something the read produced. */
      const reread = await page.evaluate<AgentOutcome>(
        verifyCall("agentRunOutcome", runId)
      )
      record(
        "agent-recovery-is-durable",
        reread.status === "paused" &&
          reread.pauseReason === "unresolved_effect" &&
          reread.stepIds.length === settled.stepIds.length,
        { reread }
      )
    }
  })
}

const main = async (): Promise<void> => {
  await run()
  reportGates({
    artifactDir,
    name: "sw-agent-recovery",
    gate: "isolated MV3 service-worker Agent run recovery",
    topology:
      "packaged Chromium benchmark extension; service worker killed via DevTools while the extension page and offscreen SQLite owner survive",
    results
  })
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
