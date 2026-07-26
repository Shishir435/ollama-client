#!/usr/bin/env node

// Section 9.4 spike phase 2: drives the single-owner topology gates in real
// packaged Chromium (unpacked MV3 extension, real chrome-extension:// origin).
//
// Gates exercised (numbering from PRIVATE_ARCHITECTURE_REBUILD_PLAN.md 9.4):
//   2. Two extension pages issue concurrent repository commands through the
//      one owner with no lost update.
//   3. Background durably writes and rereads a checkpoint while all visible
//      extension pages are closed.
//   4. Owner-document close and SQLite-worker termination recover on the next
//      call without manual reload, preserving durable state.
//   5. A worker terminated inside an open transaction rolls back to the
//      pre-transaction state on the next worker generation.
//   7. Export serializes a consistent, verifiable snapshot while another
//      client keeps writing.
//   8. Two writers keep writing (with client-side retry) across a deliberate
//      owner-document recreation, with no lost or duplicated update.
//   4c. Full browser restart (same profile relaunch) preserves durable rows
//       and the owner topology recovers without manual intervention.
//
// Forced service-worker termination mid-write (gate 4d) is covered by a
// separate runner, tools/spike-sw-termination.ts (pnpm spike:sw-termination):
// Playwright pins any worker it attaches to, so that gate launches Chromium
// itself and kills the worker over the DevTools HTTP endpoint. Also not
// covered here: incognito/split mode (explicitly unsupported for the spike),
// packaged Firefox (offscreen API is Chromium-only; MV2 uses a background
// page host).
//
// Usage: pnpm spike:owner-gates [--headful]
// Requires: pnpm benchmark:build

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { chromium } from "playwright"
import type { BrowserContext, Page, Worker as PlaywrightWorker } from "playwright"

const chromeBuildPath = resolve("build/chrome-mv3-benchmark")
const artifactDir = resolve("artifacts/persistence-benchmark")
const headful = process.argv.includes("--headful")

interface GateResult {
  gate: string
  pass: boolean
  detail: Record<string, unknown>
}

const results: GateResult[] = []

const record = (
  gate: string,
  pass: boolean,
  detail: Record<string, unknown>
): void => {
  results.push({ gate, pass, detail })
  console.error(`${pass ? "PASS" : "FAIL"} ${gate}`)
  if (!pass) console.error(JSON.stringify(detail, null, 2))
}

const findFileRecursive = (dir: string, targetName: string): string => {
  for (const entry of readdirSync(dir)) {
    const fullPath = resolve(dir, entry)
    const stats = statSync(fullPath)
    if (stats.isFile() && entry === targetName) return fullPath
    if (stats.isDirectory()) {
      const found = findFileRecursive(fullPath, targetName)
      if (found) return found
    }
  }
  return ""
}

const resolveExtensionId = async (
  context: BrowserContext,
  userDataDir: string
): Promise<string> => {
  let [serviceWorker] = context.serviceWorkers()
  if (!serviceWorker) {
    try {
      serviceWorker = await context.waitForEvent("serviceworker", {
        timeout: 10000
      })
    } catch {
      // fall through
    }
  }
  if (serviceWorker) return new URL(serviceWorker.url()).host

  await new Promise((resolvePause) => setTimeout(resolvePause, 1500))
  for (const fileName of ["Preferences", "Secure Preferences"]) {
    const preferencesPath = findFileRecursive(userDataDir, fileName)
    if (!preferencesPath) continue
    const preferences = JSON.parse(readFileSync(preferencesPath, "utf8")) as {
      extensions?: { settings?: Record<string, { path?: string }> }
    }
    for (const [id, value] of Object.entries(
      preferences?.extensions?.settings ?? {}
    )) {
      if (value?.path === chromeBuildPath) return id
    }
  }
  throw new Error("Failed to resolve Chromium extension id")
}

const getServiceWorker = async (
  context: BrowserContext
): Promise<PlaywrightWorker> => {
  const [existing] = context.serviceWorkers()
  if (existing) return existing
  return context.waitForEvent("serviceworker", { timeout: 15000 })
}

type Rpc = (op: string, payload?: unknown) => Promise<unknown>

const pageRpc =
  (page: Page): Rpc =>
  (op, payload) =>
    page.evaluate(
      ([opName, opPayload]) =>
        (
          window as unknown as {
            __spikeOwner: (op: string, payload?: unknown) => Promise<unknown>
          }
        ).__spikeOwner(opName as string, opPayload),
      [op, payload]
    )

const runGates = async (visible: boolean): Promise<void> => {
  if (!existsSync(resolve(chromeBuildPath, "spike-owner.html"))) {
    throw new Error(
      `Missing ${chromeBuildPath}/spike-owner.html — run: pnpm benchmark:build`
    )
  }

  const userDataDir = mkdtempSync(`${tmpdir()}/ollama-client-spike-owner-`)
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: !visible,
    args: [
      `--disable-extensions-except=${chromeBuildPath}`,
      `--load-extension=${chromeBuildPath}`
    ]
  })

  try {
    const extensionId = await resolveExtensionId(context, userDataDir)
    console.error(`[gates] extension id: ${extensionId}`)
    const ownerPageUrl = `chrome-extension://${extensionId}/spike-owner.html`

    const pageA = await context.newPage()
    await pageA.goto(ownerPageUrl)
    const rpcA = pageRpc(pageA)

    await rpcA("reset")
    const info = (await rpcA("ownerInfo")) as {
      ownerId: string
      workerGeneration: number
    }

    // ---- Gate 2: concurrent writers through one owner, no lost update ----
    const pageB = await context.newPage()
    await pageB.goto(ownerPageUrl)
    const rpcB = pageRpc(pageB)

    const APPENDS = 100
    const appendMany = (page: Page, writer: string, total: number) =>
      page.evaluate(
        async ([writerName, count]) => {
          const owner = (
            window as unknown as {
              __spikeOwner: (op: string, payload?: unknown) => Promise<unknown>
            }
          ).__spikeOwner
          for (let seq = 0; seq < (count as number); seq += 1) {
            await owner("append", { writer: writerName, seq })
          }
        },
        [writer, total] as const
      )

    await Promise.all([
      appendMany(pageA, "writer-a", APPENDS),
      appendMany(pageB, "writer-b", APPENDS)
    ])
    const gate2Counts = (await rpcA("counts")) as {
      total: number
      byWriter: Record<string, number>
    }
    record(
      "gate2-concurrent-writers",
      gate2Counts.total === APPENDS * 2 &&
        gate2Counts.byWriter["writer-a"] === APPENDS &&
        gate2Counts.byWriter["writer-b"] === APPENDS,
      { expected: APPENDS * 2, ...gate2Counts }
    )

    // ---- Gate 3: background write with every visible page closed ----
    await pageA.close()
    await pageB.close()
    const serviceWorker = await getServiceWorker(context)
    const checkpointState = JSON.stringify({ step: "bg-write", at: Date.now() })
    // Background code calls the owner client directly — runtime messages are
    // never delivered back to the sending context, so a SW cannot message
    // itself the way pages do.
    const bgWrite = (await serviceWorker.evaluate(
      async ([state]) =>
        (
          globalThis as unknown as {
            __spikeOwnerBgWrite: (payload: unknown) => Promise<unknown>
          }
        ).__spikeOwnerBgWrite({ requestId: "gate3-checkpoint", state }),
      [checkpointState]
    )) as { ok: boolean; error?: string } | undefined

    const pageC = await context.newPage()
    await pageC.goto(ownerPageUrl)
    const rpcC = pageRpc(pageC)
    const rereadRaw = await rpcC("readCheckpoint", {
      requestId: "gate3-checkpoint"
    })
    const reread = rereadRaw as { state: string } | null
    record(
      "gate3-background-write-pages-closed",
      Boolean(bgWrite?.ok) && reread?.state === checkpointState,
      { bgWrite, rereadState: reread?.state?.slice(0, 80) ?? null }
    )

    // ---- Gate 4a: SQLite worker termination recovers, state durable ----
    const beforeKill = (await rpcC("counts")) as { total: number }
    await rpcC("terminateWorker")
    const afterKill = (await rpcC("counts")) as { total: number }
    const infoAfterKill = (await rpcC("ownerInfo")) as {
      ownerId: string
      workerGeneration: number
    }
    record(
      "gate4a-worker-termination-recovery",
      afterKill.total === beforeKill.total &&
        infoAfterKill.workerGeneration === info.workerGeneration + 1 &&
        infoAfterKill.ownerId === info.ownerId,
      { beforeKill, afterKill, info, infoAfterKill }
    )

    // ---- Gate 4b: owner-document close recovers, state durable ----
    await pageC.evaluate(() =>
      (
        window as unknown as {
          __spikeOwnerControl: { close: () => Promise<unknown> }
        }
      ).__spikeOwnerControl.close()
    )
    const afterClose = (await rpcC("counts")) as { total: number }
    const infoAfterClose = (await rpcC("ownerInfo")) as {
      ownerId: string
      workerGeneration: number
    }
    record(
      "gate4b-owner-close-recovery",
      afterClose.total === beforeKill.total &&
        infoAfterClose.ownerId !== info.ownerId,
      { afterClose, previousOwner: info.ownerId, newOwner: infoAfterClose.ownerId }
    )

    // ---- Gate 5: kill worker inside an open transaction; must roll back ----
    const preHang = (await rpcC("counts")) as { total: number }
    const hang = (await rpcC("beginHang")) as { uncommittedTotal: number }
    await rpcC("terminateWorker")
    const postCrash = (await rpcC("counts")) as { total: number }
    record(
      "gate5-transaction-rollback-on-crash",
      hang.uncommittedTotal === preHang.total + 1 &&
        postCrash.total === preHang.total,
      { preHang, hang, postCrash }
    )

    // ---- Gate 7: consistent export while another client keeps writing ----
    await rpcC("reset")
    const pageD = await context.newPage()
    await pageD.goto(ownerPageUrl)
    const rpcD = pageRpc(pageD)
    const GATE7_APPENDS = 120
    const GATE7_SYNC_THRESHOLD = 10
    const [, exportMid] = await Promise.all([
      appendMany(pageD, "writer-export", GATE7_APPENDS),
      // Real overlap, not a fixed delay: wait until some appends have
      // committed, then export while the rest are still streaming.
      (async () => {
        for (;;) {
          const midCounts = (await rpcC("counts")) as { total: number }
          if (midCounts.total >= GATE7_SYNC_THRESHOLD) break
        }
        return (await rpcC("exportDb")) as {
          exportedBytes: number
          verifiedTotal: number
        }
      })()
    ])
    const gate7Final = (await rpcC("counts")) as { total: number }
    record(
      "gate7-export-during-writes",
      exportMid.exportedBytes > 0 &&
        // The snapshot must prove overlap: strictly after the sync point and
        // strictly before the final append.
        exportMid.verifiedTotal >= GATE7_SYNC_THRESHOLD &&
        exportMid.verifiedTotal < GATE7_APPENDS &&
        gate7Final.total === GATE7_APPENDS,
      { exportMid, gate7Final, expected: GATE7_APPENDS }
    )

    // ---- Gate 8: two writers keep writing across an owner recreation ----
    await rpcC("reset")
    const appendManyWithRetry = (page: Page, writer: string, total: number) =>
      page.evaluate(
        async ([writerName, count]) => {
          const owner = (
            window as unknown as {
              __spikeOwner: (op: string, payload?: unknown) => Promise<unknown>
            }
          ).__spikeOwner
          for (let seq = 0; seq < (count as number); seq += 1) {
            // The owner document is deliberately destroyed mid-run; a call
            // in flight at that moment fails and is retried. Each (writer,
            // seq) is appended exactly once by construction.
            for (let attempt = 0; ; attempt += 1) {
              try {
                await owner("append", { writer: writerName, seq })
                break
              } catch (error) {
                if (attempt >= 3) throw error
              }
            }
          }
        },
        [writer, total]
      )
    const GATE8_APPENDS = 80
    await Promise.all([
      appendManyWithRetry(pageC, "writer-w1", GATE8_APPENDS),
      appendManyWithRetry(pageD, "writer-w2", GATE8_APPENDS),
      (async () => {
        await new Promise((resolvePause) => setTimeout(resolvePause, 200))
        await pageC.evaluate(() =>
          (
            window as unknown as {
              __spikeOwnerControl: { close: () => Promise<unknown> }
            }
          ).__spikeOwnerControl.close()
        )
      })()
    ])
    const gate8Counts = (await rpcC("counts")) as {
      total: number
      byWriter: Record<string, number>
    }
    record(
      "gate8-writers-across-owner-recreation",
      gate8Counts.total === GATE8_APPENDS * 2 &&
        gate8Counts.byWriter["writer-w1"] === GATE8_APPENDS &&
        gate8Counts.byWriter["writer-w2"] === GATE8_APPENDS,
      { expected: GATE8_APPENDS * 2, ...gate8Counts }
    )
    await pageD.close()

    // ---- Gate 10 (informational): quota and persistence posture ----
    const storageInfo = await pageC.evaluate(async () => {
      const estimate = navigator.storage?.estimate
        ? await navigator.storage.estimate()
        : null
      return {
        usageMiB: estimate?.usage ? estimate.usage / (1024 * 1024) : null,
        quotaMiB: estimate?.quota ? estimate.quota / (1024 * 1024) : null,
        persisted: navigator.storage?.persisted
          ? await navigator.storage.persisted()
          : null
      }
    })
    record("gate10-storage-posture-info", true, storageInfo)

    // ---- Gate 4c: full browser restart preserves data, owner recovers ----
    await rpcC("reset")
    const RESTART_ROWS = 25
    await appendMany(pageC, "restart-writer", RESTART_ROWS)
    await pageC.close()
    await context.close()

    const restarted = await chromium.launchPersistentContext(userDataDir, {
      headless: !visible,
      args: [
        `--disable-extensions-except=${chromeBuildPath}`,
        `--load-extension=${chromeBuildPath}`
      ]
    })
    try {
      const pageE = await restarted.newPage()
      await pageE.goto(ownerPageUrl)
      const rpcE = pageRpc(pageE)
      const afterRestart = (await rpcE("counts")) as {
        total: number
        byWriter: Record<string, number>
      }
      record(
        "gate4c-browser-restart-recovery",
        afterRestart.byWriter["restart-writer"] === RESTART_ROWS,
        { expected: RESTART_ROWS, ...afterRestart }
      )
      await rpcE("reset")
      await pageE.close()
    } finally {
      await restarted.close()
    }
  } finally {
    try {
      await context.close()
    } catch {
      // already closed by the restart phase
    }
    rmSync(userDataDir, { recursive: true, force: true })
  }
}

const main = async (): Promise<void> => {
  try {
    await runGates(headful)
  } catch (error) {
    if (
      headful ||
      !String(error).includes("Failed to resolve Chromium extension id")
    ) {
      throw error
    }
    // Headless MV3 service workers can stay lazy; retry once visibly.
    console.error("[gates] headless bootstrap failed, retrying headful")
    results.length = 0
    await runGates(true)
  }

  const report = {
    measuredAt: new Date().toISOString(),
    topology:
      "MV3 offscreen document owning one sqlite-wasm opfs-sahpool worker; runtime-message RPC",
    results
  }
  mkdirSync(artifactDir, { recursive: true })
  const outputPath = resolve(artifactDir, `spike-owner-gates-${Date.now()}.json`)
  writeFileSync(outputPath, JSON.stringify(report, null, 2))
  console.error(`Report written: ${outputPath}`)
  console.log(JSON.stringify(report, null, 2))

  if (results.some((result) => !result.pass)) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
