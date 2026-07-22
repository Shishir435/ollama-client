import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  countMessages: vi.fn(),
  vectorCount: vi.fn(),
  providers: vi.fn(),
  listModels: vi.fn(),
  backend: vi.fn(),
  txBegin: vi.fn(),
  txRollback: vi.fn(),
  query: vi.fn(),
  events: vi.fn(),
  record: vi.fn(),
  clear: vi.fn()
}))

vi.mock("@/lib/repositories/chat-history", () => ({
  countMessages: mocks.countMessages
}))
vi.mock("@/lib/embeddings/db", () => ({
  vectorDb: { vectors: { count: mocks.vectorCount } }
}))
vi.mock("@/lib/providers/manager", () => ({
  ProviderManager: { getProviders: mocks.providers }
}))
vi.mock("@/lib/providers/provider-rpc-service", () => ({
  ProviderRpcService: { listModels: mocks.listModels }
}))
vi.mock("@/lib/persistence/backend", () => ({
  readPersistenceBackend: mocks.backend
}))
vi.mock("@/lib/persistence/client", () => ({
  rpcTxBegin: mocks.txBegin,
  rpcTxRollback: mocks.txRollback,
  rpcQuery: mocks.query
}))
vi.mock("../diagnostic-recorder", () => ({
  getDiagnosticEvents: mocks.events,
  recordDiagnosticEvent: mocks.record,
  clearDiagnosticEvents: mocks.clear
}))

import { DiagnosticsService } from "../diagnostics-service"

beforeEach(() => {
  vi.clearAllMocks()
  chrome.runtime.getManifest = vi.fn(() => ({ version: "1.2.3" })) as never
  mocks.countMessages.mockResolvedValue(12)
  mocks.vectorCount.mockResolvedValue(4)
  mocks.providers.mockResolvedValue([
    {
      id: "private-id",
      name: "Private deployment",
      type: "openai",
      enabled: true,
      baseUrl: "https://secret.example/private/path?token=secret",
      apiKey: "sk-secret",
      serviceProfile: "openrouter"
    }
  ])
  mocks.listModels.mockResolvedValue({
    models: [{ name: "private-model" }],
    failures: []
  })
  mocks.backend.mockResolvedValue("opfs")
  mocks.txBegin.mockResolvedValue(undefined)
  mocks.txRollback.mockResolvedValue(undefined)
  mocks.query.mockResolvedValue([{ ok: 1 }])
  mocks.events.mockResolvedValue([])
  mocks.record.mockResolvedValue(undefined)
  mocks.clear.mockResolvedValue(undefined)
})

describe("DiagnosticsService", () => {
  it("runs a rollback-only repository smoke test and provider discovery", async () => {
    const result = await DiagnosticsService.run()

    expect(result.tests.map((test) => test.id)).toEqual(
      expect.arrayContaining([
        "chat_repository",
        "provider_discovery",
        "migration"
      ])
    )
    expect(mocks.txBegin).toHaveBeenCalledOnce()
    expect(mocks.query).toHaveBeenCalledWith(
      "SELECT 1 AS ok",
      undefined,
      expect.stringMatching(/^diagnostic-/)
    )
    expect(mocks.txRollback).toHaveBeenCalledOnce()
    expect(mocks.listModels).toHaveBeenCalledWith(
      { enabledOnly: true },
      undefined
    )
  })

  it("exports provider classes without identities, endpoints, models, or secrets", async () => {
    const { bundle } = await DiagnosticsService.getBundle()
    const serialized = JSON.stringify(bundle)

    expect(bundle.providers).toEqual([
      { profile: "openrouter", wire: "openai", enabled: true }
    ])
    expect(serialized).not.toContain("private-id")
    expect(serialized).not.toContain("Private deployment")
    expect(serialized).not.toContain("secret.example")
    expect(serialized).not.toContain("private-model")
    expect(serialized).not.toContain("sk-secret")
  })

  it("surfaces legacy persistence as a recoverable migration action", async () => {
    mocks.backend.mockResolvedValue("legacy")
    const result = await DiagnosticsService.run()

    expect(result.tests.find((test) => test.id === "migration")).toMatchObject({
      status: "action",
      code: "OLC-STORAGE-MIGRATION-001"
    })
  })
})
