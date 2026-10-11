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

import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
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

const run = async (unattended = false): Promise<void> => {
  const recordMode = (
    gate: string,
    pass: boolean,
    detail: Record<string, unknown>
  ) =>
    record(`${unattended ? "unattended" : "supervised"}-${gate}`, pass, detail)
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
      const runId = unattended
        ? "verify-unattended-sw-loss"
        : "verify-agent-sw-loss"
      await page.evaluate(
        verifyCall("seedInterruptedAgentRun", runId, unattended)
      )
      const seeded = await page.evaluate<AgentOutcome>(
        verifyCall("agentRunOutcome", runId)
      )
      recordMode(
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
      recordMode("agent-sw-terminated", workerGone, {
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

      recordMode(
        "agent-run-paused-unresolved",
        settled.status === "paused" &&
          settled.pauseReason === "unresolved_effect",
        { settled }
      )
      recordMode(
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
      recordMode(
        "agent-recovery-is-durable",
        reread.status === "paused" &&
          reread.pauseReason === "unresolved_effect" &&
          reread.stepIds.length === settled.stepIds.length,
        { reread }
      )
    }
  })
}

/** Kill a real, safely resumable run with persisted tab/session/model consent. */
const runSafeContinuation = async (
  mode: "continuation" | "panel-close" | "stop" = "continuation"
): Promise<void> => {
  let decisions = 0
  let releaseDecision: (() => void) | undefined
  const decisionGate =
    mode === "continuation"
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          releaseDecision = resolve
        })
  const server = createServer(async (request, response) => {
    let body = ""
    for await (const chunk of request) body += chunk.toString()
    if (request.url === "/api/chat") {
      const input = JSON.parse(body)
      if (input.tools?.[0]?.function?.name === "agent_decision") decisions += 1
      await decisionGate
      response.setHeader("Content-Type", "application/x-ndjson")
      response.end(
        `${JSON.stringify({
          model: "verify-model",
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                function: {
                  name: "agent_decision",
                  arguments: {
                    type: "ask_user",
                    question: "Which status detail should I read?"
                  }
                }
              }
            ]
          },
          done: true
        })}\n`
      )
    } else if (request.url === "/api/tags") {
      response.setHeader("Content-Type", "application/json")
      response.end(
        JSON.stringify({
          models: [{ name: "verify-model", model: "verify-model" }]
        })
      )
    } else if (request.url === "/api/show") {
      response.setHeader("Content-Type", "application/json")
      response.end(JSON.stringify({ capabilities: ["tools"] }))
    } else {
      response.setHeader("Content-Type", "text/html")
      response.end(
        "<!doctype html><title>Recovery fixture</title><main><p>Status: Active</p></main>"
      )
    }
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    await withExtensionHarness({
      buildPath,
      page: "persistence-verify.html",
      async body({
        page,
        originalWorker,
        listTargets,
        findServiceWorker,
        httpJson,
        openPage
      }) {
        const runId = "verify-safe-unattended-sw-loss"
        await page.evaluate(
          verifyCall("seedSafeUnattendedAgentRun", runId, origin)
        )
        const before = await page.evaluate<AgentOutcome>(
          verifyCall("agentRunOutcome", runId)
        )
        record(
          "safe-unattended-checkpoint",
          before.status === "observing" && decisions === 0,
          { before, decisions }
        )
        await httpJson(`/json/close/${originalWorker.id}`)
        await poll(
          async () =>
            !(await listTargets()).some(
              (target) => target.id === originalWorker.id
            ),
          Boolean,
          "safe run worker terminated"
        )
        if (mode !== "continuation") {
          await poll(
            async () => {
              await page.evaluate(verifyCall("agentRunOutcome", runId))
              return decisions
            },
            (count) => count === 1,
            "recovered model request"
          )
          const panel = await openPage("sidepanel.html")
          await poll(
            () => panel.evaluate("document.readyState"),
            (state) => state === "complete",
            "supervision page ready"
          )
          await panel.evaluate(
            `window.__supervisor = chrome.runtime.connect({name:"agent-run-port"});window.__snapshotSeen=false;window.__supervisor.onMessage.addListener(m=>{if(m.type==="agent_snapshot")window.__snapshotSeen=true})`
          )
          await poll(
            () => panel.evaluate<boolean>("window.__snapshotSeen"),
            Boolean,
            "supervisor connected"
          )
          await panel.closeTarget()
          if (mode === "stop") {
            // An authenticated extension page can stop with no side panel open.
            await page.evaluate(
              `new Promise((resolve,reject)=>{const p=chrome.runtime.connect({name:"agent-run-port"});window.__stopPort=p;let sent=false;const seen=[];const timer=setTimeout(()=>reject(new Error(JSON.stringify(seen))),10000);p.onMessage.addListener(m=>{seen.push(m.type==="agent_snapshot"?{status:m.snapshot.run?.status}:m);if(m.type==="agent_command_failed"){clearTimeout(timer);reject(new Error(JSON.stringify(m)))}if(m.type==="agent_snapshot"&&!sent){sent=true;p.postMessage({type:"agent_stop",runId:${JSON.stringify(runId)}})}if(m.type==="agent_snapshot"&&m.snapshot.run?.status==="cancelled"){clearTimeout(timer);p.disconnect();resolve(true)}})})`
            )
          }
          releaseDecision?.()
        }
        const settled = await poll(
          () =>
            page.evaluate<AgentOutcome>(verifyCall("agentRunOutcome", runId)),
          (outcome) =>
            mode === "stop"
              ? outcome.status === "cancelled"
              : outcome.status === "paused" &&
                outcome.pauseReason === "question",
          "safe run continued by replacement worker",
          45_000
        )
        const replacement = findServiceWorker(await listTargets())
        record(
          `safe-unattended-${mode}`,
          decisions === 1 &&
            replacement?.id !== originalWorker.id &&
            (mode === "stop"
              ? settled.status === "cancelled"
              : settled.pauseReason === "question"),
          { settled, decisions, replacementWorkerId: replacement?.id }
        )
        record("safe-unattended-no-effect", settled.stepIds.length === 0, {
          stepIds: settled.stepIds
        })
      }
    })
  } finally {
    releaseDecision?.()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
}

const main = async (): Promise<void> => {
  await run()
  await run(true)
  await runSafeContinuation()
  await runSafeContinuation("panel-close")
  await runSafeContinuation("stop")
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
