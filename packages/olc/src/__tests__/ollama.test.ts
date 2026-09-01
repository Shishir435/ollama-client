// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"
import { parseArgs, selectBackend } from "../cli-options.js"
import { resolveConfig } from "../config.js"
import { endpoint, resolveOllamaOptions } from "../ollama/config.js"
import type { Listener } from "../ollama/process.js"
import {
  type OllamaDependencies,
  probeOllama,
  runOllama
} from "../ollama/runner.js"

const listener: Listener = {
  pid: 12345,
  identity: "original",
  host: "127.0.0.1",
  executable: "/usr/bin/ollama",
  uid: 1000
}

/** All lifecycle ports are mocks; these tests never touch the user's Ollama. */
function fixture(found: Listener[] = [listener]) {
  return {
    listeners: vi.fn().mockResolvedValue(found),
    manager: vi.fn().mockResolvedValue({ kind: "cli" }),
    environment: vi.fn().mockResolvedValue({
      OLLAMA_ORIGINS: "https://existing.example",
      OLLAMA_MODELS: "/models with spaces",
      OLLAMA_NUM_PARALLEL: "2"
    }),
    prepare: vi.fn().mockResolvedValue(undefined),
    apply: vi.fn().mockResolvedValue({ detail: "test log" }),
    probe: vi.fn().mockResolvedValue({ ready: true }),
    wait: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn()
  } satisfies OllamaDependencies
}

describe("CLI backend policy", () => {
  it("defaults to native Ollama, leaving programmatic proxies unchanged", () => {
    expect(selectBackend({}, {}, {})).toBe("ollama")
    expect(
      resolveOllamaOptions(
        {},
        {},
        { OLC_PORT: "8083", OPENCODE_PROXY_PORT: "8083" }
      )
    ).toMatchObject({ host: "127.0.0.1", port: 11434 })
    expect(resolveConfig().PORT).toBe(8084)
  })
  it("supports the short alias, equals values, and explicit proxy modes", () => {
    expect(parseArgs(["-b", "codex", "--port=9000"]).options).toEqual({
      BACKEND: "codex",
      PORT: "9000"
    })
    expect(
      selectBackend(parseArgs(["--backend=opencode"]).options, {}, {})
    ).toBe("opencode")
  })
  it("respects backend precedence without inferring from runtime flags", () => {
    expect(
      selectBackend({}, { BACKEND: "codex" }, { OLC_BACKEND: "opencode" })
    ).toBe("opencode")
    expect(
      selectBackend(
        { BACKEND: "ollama" },
        { BACKEND: "codex" },
        { OLC_BACKEND: "opencode" }
      )
    ).toBe("ollama")
    expect(() => selectBackend({ CODEX_PATH: "codex" }, {}, {})).toThrow("-b")
  })
  it.each([
    ["--port", "--lan"],
    ["--config"],
    ["--backend="],
    ["-b", "codex", "--port", "abc"],
    ["-b", "opencode", "--port", "0"],
    ["--lan=false"],
    ["--port", "1", "--port", "2"],
    ["-b", "codex", "--backend", "ollama"]
  ])("rejects ambiguous arguments %j", (...args) => {
    expect(() => parseArgs(args)).toThrow()
  })
  it.each([
    "LAN",
    "LOCAL",
    "CHECK",
    "JSON",
    "OLLAMA_PATH"
  ])("rejects native option %s on proxies", (flag) => {
    expect(() =>
      selectBackend({ BACKEND: "codex", [flag]: true }, {}, {})
    ).toThrow("not supported")
  })
  it("never pretends to enforce proxy authentication on native Ollama", () => {
    expect(() => selectBackend({ API_KEY: "secret" }, {}, {})).toThrow()
    expect(() => selectBackend({}, {}, { OLC_API_KEY: "secret" })).toThrow(
      "cannot enforce"
    )
    expect(() => selectBackend({}, { API_KEY: "secret" }, {})).toThrow(
      "cannot enforce"
    )
  })
  it("rejects unknown backends and mismatched adapter flags", () => {
    expect(() => selectBackend({ BACKEND: "olama" }, {}, {})).toThrow(
      "Backend must"
    )
    expect(() =>
      selectBackend({ BACKEND: "codex", OPENCODE_AGENT: "build" }, {}, {})
    ).toThrow("not supported")
  })
})

describe("native configuration", () => {
  it("keeps native host/port independent of legacy proxy config", () => {
    expect(
      resolveOllamaOptions({}, { PORT: 8083, BIND_HOST: "0.0.0.0" }, {})
    ).toMatchObject({ host: "127.0.0.1", port: 11434 })
    expect(
      resolveOllamaOptions(
        { PORT: "12345", LAN: true },
        {},
        { OLLAMA_HOST: "127.0.0.1:12346" }
      )
    ).toMatchObject({ host: "0.0.0.0", port: 12345, explicitHost: true })
  })
  it("accepts native environment and IPv6, and probes wildcard via loopback", () => {
    expect(
      resolveOllamaOptions({}, {}, { OLLAMA_HOST: "[::1]:12345" })
    ).toMatchObject({ host: "::1", port: 12345 })
    expect(endpoint("::", 11434)).toBe("http://[::1]:11434")
    expect(endpoint("0.0.0.0", 11434)).toBe("http://127.0.0.1:11434")
  })
  it.each([
    "0",
    "-1",
    "65536",
    "abc",
    "1.5",
    "Infinity"
  ])("rejects port %s", (PORT) => {
    expect(() => resolveOllamaOptions({ PORT }, {}, {})).toThrow("integer")
  })
  it.each([
    { LAN: true, LOCAL: true },
    { LAN: true, BIND_HOST: "localhost" },
    { BIND_HOST: "remote.example" }
  ])("rejects conflicting or remote bind options", (options) => {
    expect(() => resolveOllamaOptions(options, {}, {})).toThrow()
  })
  it.each([
    "https://127.0.0.1",
    "http://user:pass@localhost",
    "localhost/path",
    "remote.example:11434"
  ])("rejects unsafe native host %s", (OLLAMA_HOST) => {
    expect(() => resolveOllamaOptions({}, {}, { OLLAMA_HOST })).toThrow()
  })
  it("merges configured origins without removing extension access", () => {
    const result = resolveOllamaOptions(
      { ALLOWED_ORIGINS: "https://new.example" },
      {},
      { OLLAMA_ORIGINS: "https://existing.example" }
    )
    expect(result.origins).toEqual(
      expect.arrayContaining([
        "https://new.example",
        "https://existing.example",
        "moz-extension://*"
      ])
    )
  })
})

describe("native lifecycle", () => {
  it("returns a foreground session only for the process this invocation started", async () => {
    const deps = fixture()
    deps.listeners.mockResolvedValueOnce([])
    const session = { finished: new Promise<number>(() => {}), stop: vi.fn() }
    deps.apply.mockResolvedValue({ detail: "foreground", session })
    expect(
      (await runOllama(resolveOllamaOptions({ DEBUG: true }, {}, {}), deps))
        .session
    ).toBe(session)
    expect(deps.apply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ detached: false, debug: true }),
      expect.anything(),
      undefined
    )
    expect(session.stop).not.toHaveBeenCalled()
  })
  it("fails promptly when its foreground child exits during startup", async () => {
    const deps = fixture([])
    deps.probe.mockResolvedValue({ ready: false })
    const session = { finished: Promise.resolve(3), stop: vi.fn() }
    deps.apply.mockResolvedValue({ detail: "foreground", session })
    await expect(
      runOllama(resolveOllamaOptions({ FOREGROUND: true }, {}, {}), deps)
    ).rejects.toThrow("did not become ready")
    expect(session.stop).toHaveBeenCalledOnce()
  })
  it("does not take ownership of a reused server in debug mode", async () => {
    const deps = fixture()
    expect(
      (await runOllama(resolveOllamaOptions({ DEBUG: true }, {}, {}), deps))
        .session
    ).toBeUndefined()
    expect(deps.apply).not.toHaveBeenCalled()
  })
  it("reuses a healthy server without querying a manager or modifying anything", async () => {
    const deps = fixture()
    expect(
      await runOllama(resolveOllamaOptions({}, {}, {}), deps)
    ).toMatchObject({ ready: true, status: "ready", port: 11434 })
    expect(deps.apply).not.toHaveBeenCalled()
    expect(deps.environment).not.toHaveBeenCalled()
    expect(deps.manager).not.toHaveBeenCalled()
  })
  it("preserves existing LAN and makes repeated --lan idempotent", async () => {
    for (const options of [{}, { LAN: true }]) {
      const deps = fixture([{ ...listener, host: "0.0.0.0" }])
      expect(
        await runOllama(resolveOllamaOptions(options, {}, {}), deps)
      ).toMatchObject({ host: "0.0.0.0", status: "ready" })
      expect(deps.apply).not.toHaveBeenCalled()
    }
  })
  it("changes loopback to LAN through the manager and preserves settings", async () => {
    const deps = fixture()
    deps.listeners
      .mockResolvedValueOnce([listener])
      .mockResolvedValue([{ ...listener, host: "0.0.0.0" }])
    expect(
      await runOllama(resolveOllamaOptions({ LAN: true }, {}, {}), deps)
    ).toMatchObject({ status: "restarted", host: "0.0.0.0" })
    expect(deps.apply).toHaveBeenCalledWith(
      { kind: "cli" },
      expect.objectContaining({
        host: "0.0.0.0",
        origins: expect.arrayContaining(["https://existing.example"])
      }),
      expect.objectContaining({
        OLLAMA_MODELS: "/models with spaces",
        OLLAMA_NUM_PARALLEL: "2"
      }),
      listener
    )
    expect(deps.warn).toHaveBeenCalledWith(
      expect.stringContaining("no authentication")
    )
  })
  it("restores loopback only when explicitly requested", async () => {
    const deps = fixture()
    deps.listeners.mockResolvedValueOnce([{ ...listener, host: "0.0.0.0" }])
    expect(
      await runOllama(resolveOllamaOptions({ LOCAL: true }, {}, {}), deps)
    ).toMatchObject({ status: "restarted", host: "127.0.0.1" })
  })
  it("repairs missing CORS and waits for readiness after restart", async () => {
    const deps = fixture()
    deps.probe
      .mockResolvedValueOnce({ ready: false })
      .mockResolvedValueOnce({ ready: false })
    expect(
      await runOllama(resolveOllamaOptions({}, {}, {}), deps)
    ).toMatchObject({ status: "restarted" })
    expect(deps.wait).toHaveBeenCalledTimes(1)
  })
  it.each([
    { found: [] },
    { found: [listener] }
  ])("--check never starts or restarts", async ({ found }) => {
    const deps = fixture(found)
    deps.probe.mockResolvedValue({ ready: false })
    expect(
      await runOllama(resolveOllamaOptions({ CHECK: true }, {}, {}), deps)
    ).toMatchObject({ ready: false, status: "not-ready" })
    expect(deps.apply).not.toHaveBeenCalled()
    expect(deps.prepare).not.toHaveBeenCalled()
  })
  it("--check --lan detects a healthy server with the wrong bind", async () => {
    const deps = fixture()
    expect(
      await runOllama(
        resolveOllamaOptions({ CHECK: true, LAN: true }, {}, {}),
        deps
      )
    ).toMatchObject({ ready: false })
    expect(deps.apply).not.toHaveBeenCalled()
  })
  it("refuses foreign listeners before any mutating port is called", async () => {
    const deps = fixture([{ ...listener, executable: "/usr/bin/node" }])
    await expect(
      runOllama(resolveOllamaOptions({ LAN: true }, {}, {}), deps)
    ).rejects.toThrow("other than Ollama")
    expect(deps.apply).not.toHaveBeenCalled()
    expect(deps.manager).not.toHaveBeenCalled()
  })
  it("checks launch prerequisites before stopping anything", async () => {
    const deps = fixture()
    deps.prepare.mockRejectedValue(new Error("missing binary"))
    await expect(
      runOllama(resolveOllamaOptions({ LAN: true }, {}, {}), deps)
    ).rejects.toThrow("missing binary")
    expect(deps.apply).not.toHaveBeenCalled()
  })
  it("starts a stopped server and verifies its actual bind", async () => {
    const deps = fixture()
    deps.listeners.mockResolvedValueOnce([])
    expect(
      await runOllama(resolveOllamaOptions({}, {}, {}), deps)
    ).toMatchObject({ status: "started" })
    expect(deps.apply).toHaveBeenCalledOnce()
  })
  it("fails after a bounded startup without retrying a restart", async () => {
    const deps = fixture([])
    deps.probe.mockResolvedValue({ ready: false })
    await expect(
      runOllama(resolveOllamaOptions({}, {}, {}), deps)
    ).rejects.toThrow("did not become ready")
    expect(deps.apply).toHaveBeenCalledOnce()
    expect(deps.wait).toHaveBeenCalledTimes(30)
  })
})

describe("readiness probe", () => {
  afterEach(() => vi.unstubAllGlobals())
  it("requires both native version JSON and allowed extension origins", async () => {
    const fetcher = vi.fn().mockImplementation(
      async (_url, init) =>
        new Response(JSON.stringify({ version: "0.13.0" }), {
          headers: { "access-control-allow-origin": init.headers.Origin }
        })
    )
    vi.stubGlobal("fetch", fetcher)
    expect(await probeOllama("http://127.0.0.1:11434")).toEqual({ ready: true })
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("/api/version"),
      expect.objectContaining({ redirect: "error" })
    )
  })
  it("does not mistake a plain HTTP 200 for extension access", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"version":"1"}'))
    )
    expect(await probeOllama("http://127.0.0.1:11434")).toEqual({
      ready: false
    })
  })
  it("checks requested custom origins as well", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('{"version":"1"}', { status: 403 }))
    vi.stubGlobal("fetch", fetcher)
    expect(
      await probeOllama("http://127.0.0.1:11434", ["https://custom.example"])
    ).toEqual({ ready: false })
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: { Origin: "https://custom.example" } })
    )
  })
  it("rejects a non-Ollama response even with permissive CORS", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response('{"ok":true}', {
          headers: { "access-control-allow-origin": "*" }
        })
      )
    )
    expect(await probeOllama("http://127.0.0.1:11434")).toEqual({
      ready: false
    })
  })
})
