import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  countMessages: vi.fn(),
  vectorCount: vi.fn(),
  providers: vi.fn(),
  providerConfig: vi.fn(),
  listModels: vi.fn(),
  backend: vi.fn(),
  txBegin: vi.fn(),
  txRollback: vi.fn(),
  query: vi.fn(),
  events: vi.fn(),
  record: vi.fn(),
  clear: vi.fn(),
  supportsDNR: vi.fn(),
  readRule: vi.fn()
}))

vi.mock("@/lib/repositories/chat-history", () => ({
  countMessages: mocks.countMessages
}))
vi.mock("@/lib/embeddings/db", () => ({
  vectorDb: { vectors: { count: mocks.vectorCount } }
}))
vi.mock("@/lib/providers/manager", () => ({
  ProviderManager: {
    getProviders: mocks.providers,
    getProviderConfig: mocks.providerConfig
  }
}))
vi.mock("@/lib/browser-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/browser-api")>()),
  supportsDNR: mocks.supportsDNR
}))
vi.mock("@/lib/dnr-rules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dnr-rules")>()),
  readLocalProviderOriginRule: mocks.readRule
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
  // Self-test results are shared across callers for a TTL window; each test
  // needs to observe its own run.
  DiagnosticsService.__resetSelfTestCache()
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
  mocks.supportsDNR.mockReturnValue(true)
  mocks.providerConfig.mockResolvedValue({
    id: "ollama",
    baseUrl: "http://localhost:11434"
  })
  mocks.readRule.mockResolvedValue({
    installed: true,
    urlFilter: "http://localhost:11434/*",
    headerValue: "http://localhost:11434"
  })
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
    // The shared run owns its own controller so one caller's abort cannot
    // cancel another's suite; discovery still receives a real signal.
    expect(mocks.listModels).toHaveBeenCalledWith(
      { enabledOnly: true },
      expect.any(AbortSignal)
    )
  })

  it("shares one suite across bundles requested inside the TTL window", async () => {
    // Several error bubbles mounting at once is the real case: each prepares a
    // bundle, and each used to pay for a network probe and a recorded event.
    const [first, second, third] = await Promise.all([
      DiagnosticsService.getBundle(),
      DiagnosticsService.getBundle(),
      DiagnosticsService.getBundle()
    ])

    expect(mocks.listModels).toHaveBeenCalledOnce()
    expect(mocks.txBegin).toHaveBeenCalledOnce()
    expect(mocks.record).toHaveBeenCalledOnce()
    expect(second.bundle.selfTests).toEqual(first.bundle.selfTests)
    expect(third.bundle.selfTests).toEqual(first.bundle.selfTests)

    // A later caller still reuses the completed result.
    await DiagnosticsService.getBundle()
    expect(mocks.listModels).toHaveBeenCalledOnce()
    expect(mocks.record).toHaveBeenCalledOnce()
  })

  it("re-measures when the caller explicitly forces a run", async () => {
    await DiagnosticsService.run()
    await DiagnosticsService.run(undefined, { force: true })

    expect(mocks.listModels).toHaveBeenCalledTimes(2)
    expect(mocks.record).toHaveBeenCalledTimes(2)
  })

  it("does not let a forced run attach to a suite that started before it", async () => {
    // "Run self-tests" pressed while an error bubble's bundle request is still
    // in flight: that request measured the configuration from before the click,
    // so joining it would report pre-change state as the current state.
    const releases: Array<(value: unknown) => void> = []
    mocks.listModels.mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(resolve)
        })
    )

    const automatic = DiagnosticsService.run()
    const forced = DiagnosticsService.run(undefined, { force: true })
    expect(mocks.listModels).toHaveBeenCalledTimes(2)

    // Resolve the forced (newer) run first, then the older one, so an
    // out-of-order finish cannot publish the stale result.
    releases[1]?.({ models: [{ name: "after-change" }], failures: [] })
    releases[0]?.({ models: [], failures: [] })
    await Promise.all([automatic, forced])

    const { tests } = await DiagnosticsService.run()
    expect(
      tests.find((test) => test.id === "provider_discovery")?.metadata?.count
    ).toBe(1)
  })

  it("keeps one caller's abort from cancelling another caller's suite", async () => {
    const aborter = new AbortController()
    let release: (value: unknown) => void = () => {}
    mocks.listModels.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )

    const abandoned = DiagnosticsService.run(aborter.signal)
    const patient = DiagnosticsService.run()
    aborter.abort(new Error("client timeout"))

    await expect(abandoned).rejects.toThrow("client timeout")
    release({ models: [], failures: [] })
    await expect(patient).resolves.toMatchObject({
      tests: expect.arrayContaining([
        expect.objectContaining({ id: "provider_discovery" })
      ])
    })
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

  it("exports only diagnostic events from the requested chat session", async () => {
    mocks.events.mockResolvedValue([
      {
        id: "00000000-0000-4000-8000-000000000001",
        at: 1,
        level: "error",
        code: "REQUEST_FAILED",
        operation: "streaming-chat",
        surface: "background",
        sessionId: "session-current"
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        at: 2,
        level: "error",
        code: "REQUEST_FAILED",
        operation: "streaming-chat",
        surface: "background",
        sessionId: "session-other"
      }
    ])

    const { bundle } = await DiagnosticsService.getBundle(
      undefined,
      "session-current"
    )

    expect(bundle.events).toHaveLength(1)
    expect(bundle.events[0]?.sessionId).toBe("session-current")
  })

  it("reports the local-provider CORS rule as installed when it matches the configured origin", async () => {
    const { tests } = await DiagnosticsService.run()

    expect(tests.find((test) => test.id === "dnr_rules")).toMatchObject({
      status: "pass",
      metadata: { result: "installed" }
    })
  })

  it("flags a missing CORS rule as an action rather than a passing API check", async () => {
    // The distinction the test exists for: the declarativeNetRequest namespace
    // is present (capabilities() would say yes) but no rule is installed, which
    // is what makes a reachable provider answer like an unreachable one.
    mocks.readRule.mockResolvedValue({ installed: false })

    const { tests } = await DiagnosticsService.run()

    expect(tests.find((test) => test.id === "dnr_rules")).toMatchObject({
      status: "action",
      code: "OLC-DNR-RULE-MISSING-001",
      metadata: { result: "missing" }
    })
  })

  it("flags a CORS rule left behind by an earlier base URL as stale", async () => {
    mocks.providerConfig.mockResolvedValue({
      id: "ollama",
      baseUrl: "http://127.0.0.1:11434"
    })

    const { tests } = await DiagnosticsService.run()

    expect(tests.find((test) => test.id === "dnr_rules")).toMatchObject({
      status: "action",
      code: "OLC-DNR-RULE-STALE-001",
      metadata: { result: "stale" }
    })
  })

  it("reports the CORS rule as unsupported where the browser has no DNR", async () => {
    // Firefox asks the user to configure the origin on the server instead, so
    // an absent rule there is correct rather than a defect.
    mocks.supportsDNR.mockReturnValue(false)

    const { tests } = await DiagnosticsService.run()

    expect(tests.find((test) => test.id === "dnr_rules")).toMatchObject({
      status: "unsupported",
      metadata: { result: "not_applicable" }
    })
    expect(mocks.readRule).not.toHaveBeenCalled()
  })

  it("keeps the endpoint out of the CORS rule result", async () => {
    mocks.providerConfig.mockResolvedValue({
      id: "ollama",
      baseUrl: "http://secret-host.example:11434"
    })

    const { bundle } = await DiagnosticsService.getBundle()

    expect(JSON.stringify(bundle)).not.toContain("secret-host.example")
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
