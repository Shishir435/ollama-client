import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { expect, test } from "../../fixtures/extension"
import {
  openPersistenceVerifyPage,
  waitForOpfsMarker
} from "../../fixtures/persistence"

interface Counts {
  sessions: number
  messages: number
  /** Row counts for every durable table, which is what the migration verifies.
   * Matched with toMatchObject so a new table does not fail these assertions on
   * its way in. */
  tables: Record<string, number>
}

const startFakeOllama = async () => {
  const server = createServer((_request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*")
    response.setHeader("Content-Type", "application/json")
    if (_request.url === "/api/tags") {
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
    if (_request.url === "/api/show") {
      response.end(
        JSON.stringify({ capabilities: [], details: { family: "verify" } })
      )
      return
    }
    if (_request.url === "/api/chat") {
      response.setHeader("Content-Type", "application/x-ndjson")
      response.end(
        `${JSON.stringify({ message: { content: "recovered" }, done: false })}\n${JSON.stringify({ message: { content: "" }, done: true })}\n`
      )
      return
    }
    response.statusCode = 404
    response.end(JSON.stringify({ error: "not found" }))
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

test("@critical fresh OPFS profile survives a browser restart", async ({
  extension
}) => {
  let { page, call } = await openPersistenceVerifyPage(extension)
  await waitForOpfsMarker(call)
  expect((await call("counts")) as Counts).toMatchObject({
    sessions: 0,
    messages: 0
  })

  await call("appendViaFacade", "fresh-profile", 2)
  expect((await call("counts")) as Counts).toMatchObject({
    sessions: 1,
    messages: 2
  })

  await page.close()
  await extension.restart()
  ;({ page, call } = await openPersistenceVerifyPage(extension))
  await waitForOpfsMarker(call)
  expect((await call("counts")) as Counts).toMatchObject({
    sessions: 1,
    messages: 2
  })
  await page.close()
})

test("@critical a generating turn completes after browser restart", async ({
  extension
}) => {
  test.setTimeout(120_000)
  const fakeOllama = await startFakeOllama()
  try {
    let { page, call } = await openPersistenceVerifyPage(extension)
    await waitForOpfsMarker(call)
    await call("configureFakeOllama", fakeOllama.baseUrl)
    const assistantMessageId = (await call(
      "seedGeneratingTurn",
      "verify-restart-turn"
    )) as number

    await page.close()
    await extension.restart()
    ;({ page, call } = await openPersistenceVerifyPage(extension))
    await waitForOpfsMarker(call)

    await expect
      .poll(
        () =>
          call("durableTurnResult", "verify-restart-turn", assistantMessageId),
        { timeout: 30_000 }
      )
      .toEqual({ status: "completed", content: "recovered", done: true })
    await page.close()
  } finally {
    await fakeOllama.close()
  }
})

test("@critical sql.js migration is durable, idempotent, and preserves source", async ({
  extension
}) => {
  test.setTimeout(120_000)
  const fixtureSessions = 40
  const fixtureMessages = 800

  let { page, call } = await openPersistenceVerifyPage(extension)
  await waitForOpfsMarker(call)
  const seeded = (await call(
    "seedLegacyBlob",
    fixtureSessions,
    fixtureMessages
  )) as {
    sessions: number
    messages: number
    blobBytes: number
    tables: Record<string, number>
  }
  const sourceDigest = (await call("readLegacyBlobDigest")) as string
  await call("clearMarker")

  await page.close()
  await extension.restart()
  ;({ page, call } = await openPersistenceVerifyPage(extension))
  const migratedMarker = await waitForOpfsMarker(call)

  expect(migratedMarker.sourceCounts).toEqual({
    sessions: fixtureSessions,
    messages: fixtureMessages
  })
  const migratedCounts = (await call("counts")) as Counts
  expect(migratedCounts).toMatchObject({
    sessions: fixtureSessions,
    messages: fixtureMessages
  })
  // Every table the blob populated, not just the two the chat list reads.
  expect(migratedCounts.tables).toMatchObject(seeded.tables)
  expect(
    (await call("migrationReceipt")) as { outcome?: string }
  ).toMatchObject({ outcome: "migrated" })
  expect(await call("readLegacyBlobLength")).toBe(seeded.blobBytes)
  expect(await call("readLegacyBlobDigest")).toBe(sourceDigest)

  await page.close()
  await extension.restart()
  ;({ page, call } = await openPersistenceVerifyPage(extension))
  await waitForOpfsMarker(call)
  expect((await call("counts")) as Counts).toMatchObject({
    sessions: fixtureSessions,
    messages: fixtureMessages
  })

  await call("appendViaFacade", "post-migration", 2)
  await page.close()
  await extension.restart()
  ;({ page, call } = await openPersistenceVerifyPage(extension))
  expect((await call("counts")) as Counts).toMatchObject({
    sessions: fixtureSessions + 1,
    messages: fixtureMessages + 2
  })
  expect(await call("readLegacyBlobDigest")).toBe(sourceDigest)

  const exportInfo = (await call("exportInfo")) as {
    byteLength: number
    magic: string
  }
  expect(exportInfo.byteLength).toBeGreaterThan(0)
  expect(exportInfo.magic).toBe("SQLite format 3")
  await page.close()
})
