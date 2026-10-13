import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { minifyEmbeddingWorker } from "../wxt-hooks"

const source = readFileSync(
  resolve("src/lib/embeddings/native/worker.mjs"),
  "utf8"
)
const runWorker = (code: string) => {
  const harness = `
    import { readFileSync } from "node:fs"
    import { createContext, SourceTextModule, SyntheticModule } from "node:vm"
    const replies = []
    let fetches = 0
    const self = { postMessage: (message) => replies.push(message) }
    const context = createContext({ self, URL, fetch: () => {
      fetches += 1
      throw new Error("Unexpected model read")
    } })
    const module = new SourceTextModule(readFileSync(0, "utf8"), {
      context,
      initializeImportMeta(meta) {
        meta.url = "https://extension.invalid/assets/embeddings/worker.mjs"
      }
    })
    await module.link((specifier) => specifier.includes("tokenizers")
      ? new SyntheticModule(["Tokenizer"], function () {
          this.setExport("Tokenizer", class {})
        }, { context })
      : new SyntheticModule(["env"], function () {
          this.setExport("env", { wasm: {} })
        }, { context }))
    await module.evaluate()
    self.onmessage({ data: { id: "invalid", text: null } })
    self.onmessage({ data: { id: "cancelled", text: "hello" } })
    self.onmessage({ data: { id: "cancelled", cancel: true } })
    await new Promise(setImmediate)
    process.stdout.write(JSON.stringify({ replies, fetches }))
  `
  const result = spawnSync(
    process.execPath,
    ["--experimental-vm-modules", "--input-type=module", "-e", harness],
    { input: code, encoding: "utf8" }
  )
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout)
}

describe("bundled embedding worker emission", () => {
  it("emits a compact standalone module with the same local runtime imports", () => {
    const compact = minifyEmbeddingWorker(source)
    expect(compact.length).toBeLessThan(source.length - 1000)
    expect(compact).toContain("./runtime/ort.wasm.min.mjs")
    expect(compact).toContain("./runtime/tokenizers.mjs")
  })

  it("preserves invalid-input and queued-cancellation behavior without model reads", () => {
    const original = runWorker(source)
    expect(original.fetches).toBe(0)
    expect(original.replies.map((reply: { id: string }) => reply.id)).toEqual([
      "invalid",
      "cancelled"
    ])
    expect(runWorker(minifyEmbeddingWorker(source))).toEqual(original)
  })
})
