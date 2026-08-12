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
  const promptCalls = new Map<string, number>()
  const readBody = (request: import("node:http").IncomingMessage) =>
    new Promise<string>((resolve) => {
      let body = ""
      request.setEncoding("utf8")
      request.on("data", (chunk) => {
        body += chunk
      })
      request.on("end", () => resolve(body))
    })
  const line = (value: unknown) => `${JSON.stringify(value)}\n`
  const server = createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*")
    response.setHeader("Content-Type", "application/json")
    if (request.url === "/") {
      response.setHeader("Content-Type", "text/html")
      response.end("<!doctype html><title>fake provider</title>")
      return
    }
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
          capabilities: ["completion", "tools"],
          details: { family: "verify" }
        })
      )
      return
    }
    if (request.url === "/api/chat") {
      const body = JSON.parse(await readBody(request)) as {
        messages?: Array<{ role?: string; content?: string }>
      }
      const userPrompt =
        [...(body.messages ?? [])]
          .reverse()
          .find((message) => message.role === "user")?.content ?? ""
      const call = (promptCalls.get(userPrompt) ?? 0) + 1
      promptCalls.set(userPrompt, call)
      response.setHeader("Content-Type", "application/x-ndjson")

      if (userPrompt.includes("approval e2e")) {
        if (body.messages?.some((message) => message.role === "tool")) {
          response.end(
            line({
              message: { content: "approved after restart" },
              done: false
            }) + line({ message: { content: "" }, done: true })
          )
        } else {
          response.end(
            line({
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "approval-call",
                    function: {
                      name: "schedule_reminder",
                      arguments: {
                        message: "E2E reminder",
                        delay_minutes: 60
                      }
                    }
                  }
                ]
              },
              done: false
            }) + line({ message: { content: "" }, done: true })
          )
        }
        return
      }

      if (userPrompt.includes("restart e2e") && call === 1) {
        response.write(
          line({ message: { content: "before-restart " }, done: false })
        )
        setTimeout(() => {
          if (!response.destroyed) {
            response.end(line({ message: { content: "stale" }, done: true }))
          }
        }, 30_000)
        return
      }

      if (userPrompt.includes("stop e2e")) {
        response.write(line({ message: { content: "partial" }, done: false }))
        setTimeout(() => {
          if (!response.destroyed) {
            response.end(line({ message: { content: "late" }, done: true }))
          }
        }, 30_000)
        return
      }

      response.end(
        line({ message: { content: "recovered" }, done: false }) +
          line({ message: { content: "" }, done: true })
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
    callsFor: (prompt: string) => promptCalls.get(prompt) ?? 0,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
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

test("@critical durable fake-provider chat resumes once after restart", async ({
  extension
}) => {
  test.setTimeout(120_000)
  const fakeOllama = await startFakeOllama()
  const turnId = "verify-live-restart"
  const prompt = "restart e2e"
  try {
    let { page, call } = await openPersistenceVerifyPage(extension)
    await waitForOpfsMarker(call)
    await call("configureFakeOllama", fakeOllama.baseUrl)
    const assistantMessageId = (await call(
      "startDurableTurn",
      turnId,
      prompt
    )) as number

    await expect
      .poll(() => call("durableTurnResult", turnId, assistantMessageId))
      .toMatchObject({ status: "generating", content: "before-restart " })

    await page.close()
    await extension.restart()
    ;({ page, call } = await openPersistenceVerifyPage(extension))
    await expect
      .poll(() => call("durableTurnResult", turnId, assistantMessageId), {
        timeout: 30_000
      })
      .toEqual({ status: "completed", content: "recovered", done: true })
    expect(fakeOllama.callsFor(prompt)).toBe(2)
    await page.close()
  } finally {
    await fakeOllama.close()
  }
})

test("@critical reconnect then stop records cancellation", async ({
  extension
}) => {
  test.setTimeout(120_000)
  const fakeOllama = await startFakeOllama()
  const turnId = "verify-reconnect-stop"
  try {
    const { page, call } = await openPersistenceVerifyPage(extension)
    await waitForOpfsMarker(call)
    await call("configureFakeOllama", fakeOllama.baseUrl)
    const assistantMessageId = (await call(
      "startDurableTurn",
      turnId,
      "stop e2e"
    )) as number
    await expect
      .poll(() => call("durableTurnResult", turnId, assistantMessageId))
      .toMatchObject({ status: "generating", content: "partial" })

    await call("reconnectTurn", turnId)
    await expect
      .poll(() => call("turnEventTypes", turnId))
      .toContain("stream_snapshot")
    await call("stopTurn", turnId)
    await expect
      .poll(() => call("durableTurnResult", turnId, assistantMessageId))
      .toMatchObject({ status: "cancelled", done: true })
    await page.close()
  } finally {
    await fakeOllama.close()
  }
})

test("@critical tool approval checkpoint survives restart", async ({
  extension
}) => {
  test.setTimeout(120_000)
  const fakeOllama = await startFakeOllama()
  const turnId = "verify-approval-restart"
  try {
    let { page, call } = await openPersistenceVerifyPage(extension)
    await waitForOpfsMarker(call)
    await call("configureFakeOllama", fakeOllama.baseUrl)
    const assistantMessageId = (await call(
      "startDurableTurn",
      turnId,
      "approval e2e"
    )) as number
    await expect
      .poll(() => call("toolLoopResult", turnId))
      .toMatchObject({
        status: "awaiting-confirmation",
        callId: "approval-call"
      })

    await page.close()
    await extension.restart()
    ;({ page, call } = await openPersistenceVerifyPage(extension))
    await expect
      .poll(() => call("toolLoopResult", turnId))
      .toMatchObject({
        status: "awaiting-confirmation",
        callId: "approval-call"
      })
    await call("confirmTool", "approval-call", true)
    await expect
      .poll(() => call("durableTurnResult", turnId, assistantMessageId), {
        timeout: 30_000
      })
      .toEqual({
        status: "completed",
        content: "approved after restart",
        done: true
      })
    await page.close()
  } finally {
    await fakeOllama.close()
  }
})

test("@critical settings RPC rejects malformed and content-script calls", async ({
  extension
}) => {
  const fakeOllama = await startFakeOllama()
  try {
    const { page, call } = await openPersistenceVerifyPage(extension)
    await waitForOpfsMarker(call)
    await expect(call("malformedSettingsRpc")).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_request", status: 400 }
    })
    await expect(
      call("contentScriptSettingsRpc", fakeOllama.baseUrl)
    ).resolves.toMatchObject({
      success: false,
      error: { status: 403 }
    })
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
