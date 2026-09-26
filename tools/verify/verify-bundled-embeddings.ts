import assert from "node:assert/strict"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { RpcMethod } from "@ollama-client/contracts/rpc"
import { chromium } from "playwright"

/** Real production extension, disposable profile, unreachable proxy including loopback. */
const main = async () => {
  const extension = resolve(process.argv[2] ?? "build/chrome-mv3-prod")
  const profile = await mkdtemp(resolve(tmpdir(), "olc-bundled-"))
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--proxy-server=http://127.0.0.1:9",
      "--proxy-bypass-list=<-loopback>"
    ]
  })
  try {
    const serviceWorker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker", { timeout: 30000 }))
    const id = new URL(serviceWorker.url()).host
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    const violations: string[] = []
    page.on("console", (message) => {
      if (
        /Content Security Policy|Refused to.*(script|worker|WebAssembly)/i.test(
          message.text()
        )
      )
        violations.push(message.text())
    })
    const artifacts = resolve("artifacts/bundled-embeddings")
    await mkdir(artifacts, { recursive: true })
    await page.goto(`chrome-extension://${id}/options.html`)
    const call = async (
      method: RpcMethod,
      request: Record<string, unknown> = {}
    ) => {
      const result = await page.evaluate(
        async ({ method, request }) =>
          chrome.runtime.sendMessage({
            type: "app-rpc-request",
            version: 1,
            requestId: crypto.randomUUID(),
            method,
            request
          }),
        { method, request }
      )
      assert.equal(result.ok, true, JSON.stringify(result))
      return result.result
    }
    let status = await call(RpcMethod.EmbeddingsNativeStatus)
    for (
      let attempt = 0;
      attempt < 50 && status.mode !== "bundled";
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      status = await call(RpcMethod.EmbeddingsNativeStatus)
    }
    assert.equal(
      status.mode,
      "bundled",
      "new install must select bundled embeddings"
    )
    const started = performance.now()
    const first = await call(RpcMethod.EmbeddingsGenerate, {
      text: "A cat sits on the warm windowsill."
    })
    const coldMs = performance.now() - started
    assert.equal(first.ok, true, JSON.stringify(first))
    assert.equal(first.providerId, "bundled")
    assert.equal(first.embedding.length, 384)
    assert.ok(first.embedding.every(Number.isFinite))
    assert.ok(Math.abs(Math.hypot(...first.embedding) - 1) < 1e-5)
    const related = await call(RpcMethod.EmbeddingsGenerate, {
      text: "A kitten rests beside the sunny window."
    })
    const unrelated = await call(RpcMethod.EmbeddingsGenerate, {
      text: "Reset your password using the account recovery link."
    })
    const cosine = (a: number[], b: number[]) =>
      a.reduce((sum, value, i) => sum + value * b[i], 0)
    assert.ok(
      cosine(first.embedding, related.embedding) >
        cosine(first.embedding, unrelated.embedding) + 0.2
    )
    const long = await call(RpcMethod.EmbeddingsGenerate, {
      text:
        "The cat sits by the window. ".repeat(100) +
        "A password reset link arrives by email."
    })
    assert.equal(long.ok, true)
    assert.equal(long.embedding.length, 384)
    await call(RpcMethod.EmbeddingsNativeCommand, { action: "external" })
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("VectorDatabase")
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const transaction = db.transaction("vectors", "readwrite")
      for (let index = 1; index <= 10; index++)
        transaction.objectStore("vectors").put({
          id: index,
          content: `Saved research document ${index}: cats sleep near sunny windows.`,
          embedding: [1, 0],
          metadata: {
            type: ["file", "chat", "webpage"][index % 3],
            source: "verification",
            timestamp: 1,
            embeddingModel: "old",
            embeddingProviderId: "ollama"
          }
        })
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
      })
      db.close()
    })
    // An existing profile has vectors but no active-space row from this release.
    await page.evaluate(async () => {
      await chrome.storage.sync.set({
        "agent-announcement-dismissed-v1": JSON.stringify(false)
      })
      await chrome.storage.local.remove("embeddings-bundled-notice-dismissed")
      await chrome.storage.local.set({
        "onboarding-state-v2": JSON.stringify({
          version: 2,
          stage: "complete",
          completedAt: Date.now()
        })
      })
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("VectorDatabase")
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const tx = db.transaction("embeddingState", "readwrite")
      tx.objectStore("embeddingState").delete("active")
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
    })
    const readVectors = () =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("VectorDatabase")
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const rows = await new Promise<unknown[]>((resolve, reject) => {
          const request = db
            .transaction("vectors")
            .objectStore("vectors")
            .getAll()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        db.close()
        return rows
      })
    const originals = await readVectors()
    await page.setViewportSize({ width: 430, height: 900 })
    await page.goto(`chrome-extension://${id}/sidepanel.html`)
    const migrationDialog = page.getByRole("dialog", {
      name: "Built-in embeddings",
      exact: true
    })
    await page
      .getByRole("button", { name: "Maybe later", exact: true })
      .waitFor()
    assert.equal(
      await migrationDialog.count(),
      0,
      "migration must wait for the agent notice"
    )
    await page.getByRole("button", { name: "Maybe later", exact: true }).click()
    await migrationDialog.waitFor()
    await migrationDialog
      .getByRole("button", { name: "Close", exact: true })
      .click()
    await migrationDialog.waitFor({ state: "hidden" })
    await page.reload()
    assert.equal((await call(RpcMethod.EmbeddingsNativeStatus)).dismissed, true)
    assert.equal(
      (await call(RpcMethod.EmbeddingsNativeStatus)).mode,
      "external"
    )
    assert.deepEqual(
      await readVectors(),
      originals,
      "closing must preserve vectors"
    )
    await page.evaluate(() =>
      chrome.storage.local.remove("embeddings-bundled-notice-dismissed")
    )
    await migrationDialog.waitFor()
    await page
      .getByRole("button", {
        name: "Migrate to built-in embeddings",
        exact: true
      })
      .waitFor()
    await page
      .getByRole("button", { name: "Keep current setup", exact: true })
      .waitFor()
    assert.equal(
      (await call(RpcMethod.EmbeddingsNativeStatus)).mode,
      "external"
    )
    await page.mouse.move(0, 0)
    await page.screenshot({
      path: resolve(artifacts, "upgrade-offer.png"),
      animations: "disabled",
      fullPage: true
    })
    await page
      .getByRole("button", { name: "Keep current setup", exact: true })
      .click()
    await page
      .getByRole("button", {
        name: "Migrate to built-in embeddings",
        exact: true
      })
      .waitFor({ state: "hidden" })
    await page.reload()
    assert.equal(
      (await call(RpcMethod.EmbeddingsNativeStatus)).mode,
      "external"
    )
    assert.equal((await call(RpcMethod.EmbeddingsNativeStatus)).dismissed, true)
    assert.deepEqual(
      await readVectors(),
      originals,
      "keeping setup must leave every vector intact"
    )
    await page.goto(
      `chrome-extension://${id}/options.html?tab=knowledge&focus=bundled-embeddings`
    )
    await page
      .getByRole("button", {
        name: "Migrate to built-in embeddings",
        exact: true
      })
      .click()
    await page
      .getByRole("button", { name: "Use saved external provider", exact: true })
      .waitFor()
    assert.equal((await call(RpcMethod.EmbeddingsNativeStatus)).mode, "bundled")
    const migrated = (await readVectors()) as {
      embedding: number[]
      metadata: { embeddingProviderId: string }
    }[]
    assert.equal(migrated.length, originals.length)
    assert.ok(
      migrated.every(
        (row) =>
          row.embedding.length === 384 &&
          row.metadata.embeddingProviderId === "bundled"
      )
    )
    // Also retain the interrupted-batch check independently of the complete UI migration.
    await call(RpcMethod.EmbeddingsNativeCommand, { action: "external" })
    await call(RpcMethod.EmbeddingsNativeCommand, { action: "start" })
    status = await call(RpcMethod.EmbeddingsNativeCommand, { action: "step" })
    assert.equal(status.mode, "external")
    assert.equal(status.current, 8)
    await page.reload()
    status = await call(RpcMethod.EmbeddingsNativeCommand, { action: "step" })
    assert.equal(status.mode, "bundled")
    assert.equal(status.current, 10)
    const after = await call(RpcMethod.EmbeddingsGenerate, {
      text: "cats near windows"
    })
    assert.equal(after.providerId, "bundled")
    const jobId = await page.evaluate(async () => {
      const jobId = crypto.randomUUID()
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("IngestionPayloadDatabase", 20)
        request.onupgradeneeded = () => {
          request.result.createObjectStore("payloads", { keyPath: "jobId" })
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const tx = db.transaction("payloads", "readwrite")
      tx.objectStore("payloads").put({
        kind: "raw",
        jobId,
        fileId: `file-${jobId}`,
        knowledgeSetId: "default",
        fileName: "offline-telescope.txt",
        contentType: "text/plain",
        autoEmbed: true,
        createdAt: Date.now(),
        lastModified: Date.now(),
        bytes: new TextEncoder().encode(
          "The orbital telescope observes distant galaxies and nebulae. Astronomers use its mirrors to study the formation of stars beyond the Milky Way."
        ).buffer
      })
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
      return jobId
    })
    let ingestion = await call(RpcMethod.IngestionSubmit, { jobId })
    for (
      let attempt = 0;
      attempt < 100 && ["queued", "running"].includes(ingestion.status);
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      ingestion = await call(RpcMethod.IngestionGet, { jobId })
    }
    assert.equal(ingestion.status, "completed", JSON.stringify(ingestion))
    await call(RpcMethod.IngestionAck, { jobId })
    const network = await serviceWorker.evaluate(async () => {
      const results = []
      for (const url of [
        "https://huggingface.co",
        "http://127.0.0.1:11434/api/tags"
      ]) {
        try {
          await fetch(url)
          results.push(true)
        } catch {
          results.push(false)
        }
      }
      return results
    })
    assert.deepEqual(network, [false, false])
    assert.deepEqual(violations, [])
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(
      `chrome-extension://${id}/options.html?tab=knowledge&focus=bundled-embeddings`
    )
    await page
      .locator('[data-settings-focus-id="bundled-embeddings"]')
      .waitFor({ state: "visible" })
    await page
      .locator('[data-settings-focus-id="bundled-embeddings"]')
      .scrollIntoViewIfNeeded()
    await page.screenshot({
      path: resolve(artifacts, "settings.png"),
      fullPage: true
    })
    const searchCard = page.locator(
      '[data-settings-focus-id="embeddings-test-search"]'
    )
    await searchCard.locator("input").fill("orbital telescope distant galaxies")
    await searchCard.locator("input").press("Enter")
    await searchCard
      .getByText("The orbital telescope observes distant galaxies", {
        exact: false
      })
      .waitFor({ state: "visible" })
    const report = {
      browser: context.browser()?.version(),
      coldMs,
      model: first.model,
      dimension: first.embedding.length,
      related: cosine(first.embedding, related.embedding),
      unrelated: cosine(first.embedding, unrelated.embedding),
      status,
      networkBlocked: true,
      ingestion: ingestion.status,
      semanticSearch: "passed",
      upgradeOffer: "visible",
      keepCurrentSetup: "preserved across reload",
      migrationFromSettings: "passed",
      cspViolations: violations
    }
    await writeFile(
      resolve(artifacts, "chromium.json"),
      JSON.stringify(report, null, 2)
    )
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await context.close()
  }
}
void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
