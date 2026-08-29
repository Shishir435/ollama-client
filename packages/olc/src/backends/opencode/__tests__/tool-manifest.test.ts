import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import {
  manifestSignature,
  normalizeToolDefinitions,
  ToolManifest
} from "../tool-manifest.js"

const created: string[] = []
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "olc-test-"))
  created.push(dir)
  return dir
}

afterEach(() => {
  while (created.length > 0) {
    rmSync(created.pop() as string, { recursive: true, force: true })
  }
})

const tool = (name: string, description = "") => ({
  type: "function",
  function: {
    name,
    description,
    parameters: { type: "object", properties: {} }
  }
})

describe("normalizeToolDefinitions", () => {
  it("keeps named function tools and drops the rest", () => {
    expect(
      normalizeToolDefinitions([
        tool("list_tabs"),
        { type: "function" },
        { type: "function", function: { name: "  " } },
        "nonsense"
      ]).map((definition: { name: string }) => definition.name)
    ).toEqual(["list_tabs"])
  })

  it("is order-independent so a reordered request is not a change", () => {
    const first = normalizeToolDefinitions([tool("b"), tool("a")])
    const second = normalizeToolDefinitions([tool("a"), tool("b")])
    expect(manifestSignature(first)).toBe(manifestSignature(second))
  })

  it("drops duplicates by name", () => {
    expect(normalizeToolDefinitions([tool("a"), tool("a")])).toHaveLength(1)
  })
})

describe("ToolManifest", () => {
  it("reports a change only when registration would differ", () => {
    const manifest = new ToolManifest({
      directory: tempDir(),
      endpoint: "http://127.0.0.1:8083/bridge/call",
      token: "t"
    })

    expect(manifest.sync([tool("list_tabs")])).toEqual({
      changed: true,
      names: ["list_tabs"]
    })
    expect(manifest.sync([tool("list_tabs")]).changed).toBe(false)
    expect(manifest.sync([tool("list_tabs", "now described")]).changed).toBe(
      true
    )
    expect(
      manifest.sync([tool("list_tabs", "now described"), tool("read_tab")])
    ).toEqual({ changed: true, names: ["list_tabs", "read_tab"] })
    expect(manifest.sync([]).names).toEqual([])
  })

  it("writes the plugin, its manifest, and the runtime link", () => {
    const directory = join(tempDir(), "plugin")
    const runtime = tempDir()
    const manifest = new ToolManifest({
      directory,
      endpoint: "http://127.0.0.1:8083/bridge/call",
      token: "secret"
    })

    const result = manifest.install({
      sourceDirectory: fileURLToPath(new URL("../plugin", import.meta.url)),
      pluginRuntimeDirectory: runtime
    })

    expect(result.linked).toBe(true)
    expect(existsSync(join(directory, "bridge.ts"))).toBe(true)
    expect(existsSync(join(directory, "json-schema.ts"))).toBe(true)
    expect(lstatSync(join(directory, "node_modules")).isSymbolicLink()).toBe(
      true
    )
    expect(manifest.pluginEntry).toBe(`file://${join(directory, "bridge.ts")}`)

    manifest.sync([tool("list_tabs")])
    const written = JSON.parse(
      readFileSync(join(directory, "manifest.json"), "utf8")
    )
    expect(written).toMatchObject({
      endpoint: "http://127.0.0.1:8083/bridge/call",
      token: "secret",
      tools: [{ name: "list_tabs" }]
    })
  })

  it("does not link a runtime directory that does not exist", () => {
    const directory = join(tempDir(), "plugin")
    const manifest = new ToolManifest({ directory, endpoint: "e", token: "t" })

    const result = manifest.install({
      sourceDirectory: fileURLToPath(new URL("../plugin", import.meta.url)),
      pluginRuntimeDirectory: join(tmpdir(), "olc-missing-runtime")
    })

    expect(result.linked).toBe(false)
  })

  it("names the tools OpenCode failed to register", () => {
    const manifest = new ToolManifest({
      directory: tempDir(),
      endpoint: "e",
      token: "t"
    })
    manifest.sync([tool("list_tabs"), tool("read_tab")])

    expect(manifest.missingRegistrations(["bash", "list_tabs"])).toEqual([
      "read_tab"
    ])
    expect(manifest.missingRegistrations([])).toEqual(["list_tabs", "read_tab"])
  })
})
