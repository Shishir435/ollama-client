#!/usr/bin/env node

/**
 * End-to-end durable-turn recovery after isolated MV3 service-worker loss.
 *
 * The worker is killed for real while the extension page and the offscreen
 * SQLite owner keep running, so a fresh worker resumes the generating turn
 * through the real stream port and persistence paths. The launch, attach and
 * termination mechanics are shared with the other worker-loss runners; see
 * `lib/chromium-extension-harness.ts` for why Playwright cannot do this.
 *
 * Usage: pnpm verify:sw-turn-recovery
 * Requires: pnpm benchmark:build
 */

import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { resolve } from "node:path"

import {
  type ExtensionHarness,
  type GateResult,
  gateRecorder,
  poll,
  reportGates,
  verifyCall,
  withExtensionHarness
} from "./lib/chromium-extension-harness"

const buildPath = resolve("build/chrome-mv3-benchmark")
const artifactDir = resolve("artifacts/e2e")

interface TurnResult {
  status?: string
  content?: string
  done?: boolean
}

const results: GateResult[] = []
const record = gateRecorder(results)

const startFakeOllama = async () => {
  const prompt = "isolated worker loss e2e"
  let calls = 0
  const pending = new Set<ReturnType<typeof setTimeout>>()
  const server = createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*")
    response.setHeader("Content-Type", "application/json")
    if (request.url === "/api/tags") {
      response.end(
        JSON.stringify({
          models: [
            {
              name: "verify-model",
              model: "verify-model",
              modified_at: new Date(0).toISOString(),
              size: 1,
              digest: "verify",
              details: { family: "verify", families: ["verify"] }
            }
          ]
        })
      )
      return
    }
    if (request.url === "/api/show") {
      response.end(
        JSON.stringify({
          capabilities: ["completion"],
          details: { family: "verify" }
        })
      )
      return
    }
    if (request.url === "/api/chat") {
      for await (const _chunk of request) {
        // Drain request before responding.
      }
      calls += 1
      response.setHeader("Content-Type", "application/x-ndjson")
      if (calls === 1) {
        response.write(
          `${JSON.stringify({ message: { content: "before-worker-kill " }, done: false })}\n`
        )
        const timer = setTimeout(() => {
          pending.delete(timer)
          if (!response.destroyed) {
            response.end(
              `${JSON.stringify({ message: { content: "stale" }, done: true })}\n`
            )
          }
        }, 30_000)
        pending.add(timer)
        return
      }
      response.end(
        `${JSON.stringify({ message: { content: "recovered" }, done: false })}\n${JSON.stringify({ message: { content: "" }, done: true })}\n`
      )
      return
    }
    response.statusCode = 404
    response.end(JSON.stringify({ error: "not found" }))
  })
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen)
    server.listen(0, "127.0.0.1", resolveListen)
  })
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    prompt,
    calls: () => calls,
    close: () =>
      new Promise<void>((resolveClose) => {
        for (const timer of pending) clearTimeout(timer)
        pending.clear()
        server.close(() => resolveClose())
        server.closeAllConnections()
      })
  }
}

const run = async (): Promise<void> => {
  const fakeOllama = await startFakeOllama()
  try {
    await withExtensionHarness({
      buildPath,
      page: "persistence-verify.html",
      body: (harness) => driveTurnRecovery(harness, fakeOllama)
    })
  } finally {
    await fakeOllama.close()
  }
}

const driveTurnRecovery = async (
  {
    page,
    originalWorker,
    listTargets,
    findServiceWorker,
    httpJson
  }: ExtensionHarness,
  fakeOllama: Awaited<ReturnType<typeof startFakeOllama>>
): Promise<void> => {
  {
    await poll(
      () =>
        page?.evaluate<{ backend?: string } | null>(
          verifyCall("backendMarker")
        ) ?? Promise.resolve(null),
      (marker) => marker?.backend === "opfs",
      "OPFS backend marker"
    )

    await page.evaluate(verifyCall("configureFakeOllama", fakeOllama.baseUrl))
    const turnId = "verify-isolated-sw-loss"
    const assistantMessageId = await page.evaluate<number>(
      verifyCall("startDurableTurn", turnId, fakeOllama.prompt)
    )
    const beforeKill = await poll(
      () =>
        page?.evaluate<TurnResult>(
          verifyCall("durableTurnResult", turnId, assistantMessageId)
        ) ?? Promise.resolve<TurnResult>({}),
      (result) =>
        result.status === "generating" &&
        result.content === "before-worker-kill ",
      "first streamed chunk"
    )
    record("isolated-sw-turn-started", fakeOllama.calls() === 1, {
      calls: fakeOllama.calls(),
      beforeKill
    })

    const closeResult = await httpJson(`/json/close/${originalWorker.id}`)
    const workerGone = await poll(
      async () =>
        !(await listTargets()).some(
          (target) => target.id === originalWorker.id
        ),
      Boolean,
      "original service-worker termination"
    )
    record("isolated-sw-terminated", workerGone, {
      originalWorkerId: originalWorker.id,
      closeResult
    })

    await page.evaluate(verifyCall("reconnectTurn", turnId))
    const replacementWorkerCandidate = await poll(
      async () => findServiceWorker(await listTargets()),
      (target) => Boolean(target && target.id !== originalWorker.id),
      "replacement service worker"
    )
    if (!replacementWorkerCandidate) {
      throw new Error("Replacement service worker disappeared during recovery")
    }
    const replacementWorker = replacementWorkerCandidate
    const completed = await poll(
      () =>
        page?.evaluate<TurnResult>(
          verifyCall("durableTurnResult", turnId, assistantMessageId)
        ) ?? Promise.resolve<TurnResult>({}),
      (result) =>
        result.status === "completed" &&
        result.content === "recovered" &&
        result.done === true,
      "durable turn recovery"
    )
    const eventSummary = await page.evaluate<{
      completedSnapshots: number
      eventTypes: string[]
      snapshots: number
      terminalChunks: number
    }>(verifyCall("turnEventSummary", turnId))
    record(
      "isolated-sw-turn-recovered-once",
      fakeOllama.calls() === 2 &&
        eventSummary.snapshots === 1 &&
        eventSummary.terminalChunks <= 1 &&
        eventSummary.completedSnapshots + eventSummary.terminalChunks >= 1,
      {
        calls: fakeOllama.calls(),
        completed,
        eventSummary,
        originalWorkerId: originalWorker.id,
        replacementWorkerId: replacementWorker.id
      }
    )
  }
}

const main = async (): Promise<void> => {
  await run()
  reportGates({
    artifactDir,
    name: "sw-turn-recovery",
    gate: "isolated MV3 service-worker durable-turn recovery",
    topology:
      "packaged Chromium benchmark extension; service worker killed via DevTools while extension page and offscreen SQLite owner survive",
    results
  })
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
