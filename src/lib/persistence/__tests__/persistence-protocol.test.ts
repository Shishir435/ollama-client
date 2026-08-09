import { describe, expect, it } from "vitest"
import {
  isPersistenceOwnerSender,
  isTrustedPersistenceSender
} from "../host-authorization"
import {
  decodePersistenceWireOp,
  PERSISTENCE_ENSURE,
  PERSISTENCE_LIMITS,
  PERSISTENCE_MARKER,
  PERSISTENCE_RPC,
  PersistenceEnsureRequestSchema,
  PersistenceEnsureResponseSchema,
  PersistenceOpSchema,
  PersistenceRpcRequestSchema,
  PersistenceRpcResponseSchema,
  PersistenceStateRequestSchema
} from "../protocol"

const extensionId = "extension-id"
const extensionUrlPrefix = "chrome-extension://extension-id/"
const ownerUrl = `${extensionUrlPrefix}persistence-host.html?owner=1`

describe("persistence operation contracts", () => {
  it("decodes a validated wire BLOB into the engine operation", () => {
    const parsed = PersistenceRpcRequestSchema.parse({
      type: PERSISTENCE_RPC,
      request: {
        op: "run",
        sql: "INSERT INTO files (data) VALUES (?)",
        bind: [{ __persistenceBlob: true, bytes: [0, 128, 255] }]
      }
    })

    const operation = decodePersistenceWireOp(parsed.request)
    expect(operation).toEqual({
      op: "run",
      sql: "INSERT INTO files (data) VALUES (?)",
      bind: [Uint8Array.from([0, 128, 255])]
    })
    expect(PersistenceOpSchema.safeParse(operation).success).toBe(true)
  })

  it("rejects host-only, unknown, and extra-field wire operations", () => {
    for (const request of [
      { op: "setBackend", backend: "legacy" },
      { op: "destroyEverything" },
      { op: "ping", sql: "DROP TABLE sessions" }
    ]) {
      expect(
        PersistenceRpcRequestSchema.safeParse({
          type: PERSISTENCE_RPC,
          request
        }).success
      ).toBe(false)
    }
  })

  it("rejects malformed values before they reach the worker", () => {
    expect(
      PersistenceRpcRequestSchema.safeParse({
        type: PERSISTENCE_RPC,
        request: {
          op: "run",
          sql: "SELECT 1",
          bind: [{ __persistenceBlob: true, bytes: [256] }]
        }
      }).success
    ).toBe(false)
    expect(
      PersistenceOpSchema.safeParse({ op: "query", sql: "", bind: [] }).success
    ).toBe(false)
    expect(
      PersistenceOpSchema.safeParse({
        op: "txBegin",
        token: "x".repeat(PERSISTENCE_LIMITS.transactionTokenChars + 1)
      }).success
    ).toBe(false)
  })

  it("keeps ensure and response envelopes strict", () => {
    expect(
      PersistenceEnsureRequestSchema.safeParse({ type: PERSISTENCE_ENSURE })
        .success
    ).toBe(true)
    expect(
      PersistenceEnsureRequestSchema.safeParse({
        type: PERSISTENCE_ENSURE,
        injected: true
      }).success
    ).toBe(false)
    expect(
      PersistenceRpcResponseSchema.safeParse({ ok: true, result: "pong" })
        .success
    ).toBe(true)
    expect(
      PersistenceEnsureResponseSchema.safeParse({ ok: true }).success
    ).toBe(true)
    expect(
      PersistenceEnsureResponseSchema.safeParse({
        ok: true,
        result: "not allowed"
      }).success
    ).toBe(false)
    expect(
      PersistenceRpcResponseSchema.safeParse({ ok: false, error: 500 }).success
    ).toBe(false)
  })
})

describe("persistence marker contracts", () => {
  it("accepts exact owner marker reads and writes", () => {
    expect(
      PersistenceStateRequestSchema.safeParse({
        type: PERSISTENCE_MARKER,
        action: "get",
        scope: "backend"
      }).success
    ).toBe(true)
    expect(
      PersistenceStateRequestSchema.safeParse({
        type: PERSISTENCE_MARKER,
        action: "set",
        scope: "override",
        value: true
      }).success
    ).toBe(true)
  })

  it("rejects invalid marker values and undeclared fields", () => {
    expect(
      PersistenceStateRequestSchema.safeParse({
        type: PERSISTENCE_MARKER,
        action: "set",
        scope: "override",
        value: "true"
      }).success
    ).toBe(false)
    expect(
      PersistenceStateRequestSchema.safeParse({
        type: PERSISTENCE_MARKER,
        action: "get",
        scope: "receipt",
        value: { forged: true }
      }).success
    ).toBe(false)
  })
})

describe("persistence sender authorization", () => {
  it("accepts extension pages and background sender evidence", () => {
    expect(
      isTrustedPersistenceSender(
        { id: extensionId, url: `${extensionUrlPrefix}sidepanel.html` },
        extensionId,
        extensionUrlPrefix
      )
    ).toBe(true)
    expect(
      isTrustedPersistenceSender(
        { id: extensionId },
        extensionId,
        extensionUrlPrefix
      )
    ).toBe(true)
  })

  it("rejects content scripts, foreign extensions, and web pages", () => {
    expect(
      isTrustedPersistenceSender(
        { id: extensionId, tab: { id: 1 }, url: "https://example.com" },
        extensionId,
        extensionUrlPrefix
      )
    ).toBe(false)
    expect(
      isTrustedPersistenceSender(
        { id: "foreign", url: `${extensionUrlPrefix}options.html` },
        extensionId,
        extensionUrlPrefix
      )
    ).toBe(false)
    expect(
      isTrustedPersistenceSender(
        { url: "https://example.com" },
        extensionId,
        extensionUrlPrefix
      )
    ).toBe(false)
  })

  it("reserves marker access for the exact owner document", () => {
    expect(
      isPersistenceOwnerSender(
        { id: extensionId, url: ownerUrl },
        extensionId,
        extensionUrlPrefix,
        ownerUrl
      )
    ).toBe(true)
    expect(
      isPersistenceOwnerSender(
        { id: extensionId, url: `${extensionUrlPrefix}options.html` },
        extensionId,
        extensionUrlPrefix,
        ownerUrl
      )
    ).toBe(false)
    expect(
      isPersistenceOwnerSender(
        { id: extensionId, url: `${extensionUrlPrefix}persistence-host.html` },
        extensionId,
        extensionUrlPrefix,
        ownerUrl
      )
    ).toBe(false)
  })
})
