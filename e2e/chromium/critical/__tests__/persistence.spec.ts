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
