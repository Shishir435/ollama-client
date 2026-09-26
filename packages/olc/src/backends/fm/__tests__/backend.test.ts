import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it, vi } from "vitest"
import { parseArgs, selectBackend, usageFor } from "../../../cli-options.js"
import { resolveConfig } from "../../../config.js"
import { createBackend } from "../../registry.js"
import type { BackendContext } from "../../types.js"
import {
  createFmBackend,
  createSseReader,
  describeFmError,
  FM_CATALOG_MODEL,
  toFmMessages
} from "../index.js"

const context = (
  options: Record<string, unknown> = {},
  fileOptions: Record<string, unknown> = {}
): BackendContext => ({
  config: resolveConfig({ BACKEND: "fm" }),
  options,
  fileOptions,
  log: () => {},
  retryAsync: (operation) => operation(),
  callClientTool: async () => ""
})

describe("fm backend selection", () => {
  it("accepts fm and its apple alias on macOS", () => {
    expect(
      selectBackend(parseArgs(["-b", "fm"]).options, {}, {}, "darwin")
    ).toBe("fm")
    expect(
      selectBackend(parseArgs(["-b", "apple"]).options, {}, {}, "darwin")
    ).toBe("fm")
  })

  /** Refused by name up front, rather than failing once startup looks for fm. */
  it.each([
    "linux",
    "win32"
  ] as const)("refuses fm on %s with the reason", (platform) => {
    expect(() =>
      selectBackend(parseArgs(["-b", "apple"]).options, {}, {}, platform)
    ).toThrow(/only on macOS 27 or later/)
  })

  it("offers fm in help on macOS only", () => {
    expect(usageFor("darwin")).toContain("olc -b fm")
    expect(usageFor("darwin")).toContain("--fm <path>")
    for (const platform of ["linux", "win32"] as const) {
      const usage = usageFor(platform)
      expect(usage).not.toMatch(/\bfm\b|Apple/)
      expect(usage).toContain("ollama (default), codex, or opencode")
    }
  })

  it("listens on its own port, clear of the other backends", () => {
    expect(resolveConfig({ BACKEND: "fm" }).PORT).toBe(8085)
  })

  it("refuses another backend's options", () => {
    expect(() =>
      selectBackend(
        { BACKEND: "fm", CODEX_PATH: "/bin/codex" },
        {},
        {},
        "darwin"
      )
    ).toThrow(/CODEX_PATH is not supported by fm/)
    expect(() =>
      selectBackend({ BACKEND: "codex", FM_PATH: "/usr/bin/fm" }, {}, {})
    ).toThrow(/FM_PATH is not supported by codex/)
  })

  it("is registered", () => {
    expect(createBackend("fm", context()).id).toBe("fm")
  })
})

describe("fm catalog", () => {
  /**
   * The client resolves capabilities from these flags, so a model that
   * answers tools in prose must not claim to call them.
   */
  it("reports one text-and-image model with an 8K window and no tools", async () => {
    const backend = createFmBackend(context())
    expect(await backend.listModels()).toEqual([FM_CATALOG_MODEL])
    expect(FM_CATALOG_MODEL).toMatchObject({
      id: "apple/foundation",
      context_length: 8192,
      capabilities: { function_calling: false, vision: true, reasoning: false }
    })
  })

  it.each([
    "",
    "apple/foundation",
    "foundation",
    "system",
    "apple/system"
  ])("routes %j to the on-device model", async (requested) => {
    expect(await createFmBackend(context()).resolveModel(requested)).toEqual({
      providerId: "apple",
      modelId: "foundation"
    })
  })

  it("names the only model when asked for another", async () => {
    expect(
      await createFmBackend(context()).resolveModel("gpt-5")
    ).toMatchObject({ error: expect.stringContaining("apple/foundation") })
  })
})

describe("fm wire", () => {
  it("forwards only the roles fm serve knows", () => {
    expect(
      toFmMessages([
        { role: "system", content: "Be brief." },
        { role: "user", content: "Hi" },
        { role: "tool", content: "{}", tool_call_id: "c1" },
        { role: "assistant", content: null }
      ])
    ).toEqual([
      { role: "system", content: "Be brief." },
      { role: "user", content: "Hi" },
      { role: "assistant", content: "" }
    ])
  })

  it("reads data lines across chunk boundaries", () => {
    const seen: string[] = []
    const read = createSseReader((payload) => seen.push(payload))
    read('data: {"a":1}\n\nda')
    read('ta: {"b":2}\r\n\ndata: [DONE]\n')
    expect(seen).toEqual(['{"a":1}', '{"b":2}', "[DONE]"])
  })

  it("says what to do when the conversation outgrows the window", () => {
    expect(
      describeFmError(
        500,
        '{"error":{"message":"The session\'s transcript exceeded the model\'s context size."}}'
      )
    ).toMatch(/longer than the Apple Foundation Model's 8K context/)
  })

  it("names Apple's guardrails rather than a server error", () => {
    expect(
      describeFmError(
        500,
        '{"error":{"message":"The model\'s safety guardrails were triggered."}}'
      )
    ).toBe("Apple's safety guardrails declined this request.")
  })

  it("passes any other message on as it stands", () => {
    expect(describeFmError(503, "busy")).toBe("fm serve returned 503: busy")
  })
})

describe("fm startup", () => {
  it("reports a missing fm executable by name", async () => {
    const backend = createFmBackend(
      context({ FM_PATH: "/nonexistent/olc-test-fm" })
    )
    await expect(backend.ensureReady()).rejects.toThrow(
      process.platform === "darwin"
        ? /was not found/
        : /only on macOS 27 or later/
    )
    await backend.shutdown()
  })
})

/**
 * A stand-in `fm` on the same socket protocol: slow to listen, so a second
 * caller arrives mid-startup, and a chat stream that `MODE` can cut short.
 */
const FAKE_FM = `#!/usr/bin/env node
const http = require("node:http")
const socket = process.argv[process.argv.indexOf("--socket") + 1]
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.end(JSON.stringify({ models: [{ name: "system", available: true }] }))
    return
  }
  res.writeHead(200, { "content-type": "text/event-stream" })
  res.write('data: {"choices":[{"delta":{"content":"Hel"}}]}\\n\\n')
  if (process.env.FAKE_FM_MODE === "truncate") return res.end()
  res.write('data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}\\n\\n')
  res.end("data: [DONE]\\n\\n")
})
setTimeout(() => server.listen(socket), 400)
`

describe.runIf(process.platform === "darwin")("fm serve relay", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "olc-fake-fm-"))
  const fake = path.join(dir, "fm")
  writeFileSync(fake, FAKE_FM)
  chmodSync(fake, 0o755)
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const turn = async (mode: string) => {
    vi.stubEnv("FAKE_FM_MODE", mode)
    const backend = createFmBackend(context({ FM_PATH: fake }))
    try {
      await Promise.all([backend.ensureReady(), backend.ensureReady()])
      const started = await backend.startTurn({
        requestId: mode,
        messages: [{ role: "user", content: "Hi" }]
      } as Parameters<typeof backend.startTurn>[0])
      return await started.run({ onText: () => {} } as never, {
        suspended: new Promise(() => {}),
        hasUnannouncedToolCalls: () => false
      })
    } finally {
      await backend.shutdown()
      vi.unstubAllEnvs()
    }
  }

  /** Both callers wait for `/health`; neither reaches a socket not yet listening. */
  it("answers once every concurrent caller has waited for readiness", async () => {
    expect(await turn("complete")).toMatchObject({
      status: "completed",
      content: "Hello",
      finish: "stop"
    })
  })

  it("fails a stream cut off before its finish", async () => {
    expect(await turn("truncate")).toMatchObject({
      status: "failed",
      error: { message: expect.stringContaining("before the answer finished") }
    })
  })

  /** CLI, then environment, then config file. */
  it.each<[Record<string, string>, Record<string, string>, string, boolean]>([
    [{ FM_PATH: "/nonexistent/cli-fm" }, {}, "/nonexistent/cli-fm", true],
    [{}, { FM_PATH: "/nonexistent/file-fm" }, "/nonexistent/env-fm", true],
    [{}, { FM_PATH: "/nonexistent/file-fm" }, "/nonexistent/file-fm", false]
  ])("resolves the executable in precedence order (%#)", async (options, file, expected, withEnv) => {
    if (withEnv) vi.stubEnv("OLC_FM_PATH", "/nonexistent/env-fm")
    else vi.stubEnv("OLC_FM_PATH", "")
    const backend = createFmBackend(context(options, file))
    try {
      await expect(backend.ensureReady()).rejects.toThrow(
        `'${expected}' was not found`
      )
    } finally {
      await backend.shutdown()
      vi.unstubAllEnvs()
    }
  })
})
