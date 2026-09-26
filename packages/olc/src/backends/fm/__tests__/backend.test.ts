import { describe, expect, it } from "vitest"
import { parseArgs, selectBackend } from "../../../cli-options.js"
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

const context = (options: Record<string, unknown> = {}): BackendContext => ({
  config: resolveConfig({ BACKEND: "fm" }),
  options,
  fileOptions: {},
  log: () => {},
  retryAsync: (operation) => operation(),
  callClientTool: async () => ""
})

describe("fm backend selection", () => {
  it("accepts fm and its apple alias", () => {
    expect(selectBackend(parseArgs(["-b", "fm"]).options, {}, {})).toBe("fm")
    expect(selectBackend(parseArgs(["-b", "apple"]).options, {}, {})).toBe("fm")
  })

  it("listens on its own port, clear of the other backends", () => {
    expect(resolveConfig({ BACKEND: "fm" }).PORT).toBe(8085)
  })

  it("refuses another backend's options", () => {
    expect(() =>
      selectBackend({ BACKEND: "fm", CODEX_PATH: "/bin/codex" }, {}, {})
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
