import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { minifyEmbeddingWorker } from "../wxt-hooks"

const source = readFileSync(
  resolve("src/lib/embeddings/native/worker.mjs"),
  "utf8"
)
const runWorker = (code: string, successful = false) => {
  const harness = `
    import { readFileSync } from "node:fs"
    import { createContext, SourceTextModule, SyntheticModule } from "node:vm"
    const replies = []
    let fetches = 0
    const reads = []
    const tensors = []
    const runs = []
    const initialization = []
    const env = { wasm: {} }
    const definition = { model: { type: "WordPiece" } }
    const config = { model_max_length: 256 }
    const model = new Uint8Array([1, 2, 3]).buffer
    class Tensor {
      constructor(type, data, dims) {
        Object.assign(this, { type, data, dims, disposed: 0 })
        tensors.push(this)
      }
      dispose() { this.disposed += 1 }
    }
    const self = { postMessage: (message) => replies.push(message) }
    const context = createContext({ self, URL, fetch: async (url) => {
      fetches += 1
      if (!${successful}) throw new Error("Unexpected model read")
      reads.push(url.href)
      return { ok: true,
        json: async () => url.pathname.endsWith("tokenizer.json") ? definition : config,
        arrayBuffer: async () => model
      }
    } })
    const module = new SourceTextModule(readFileSync(0, "utf8"), {
      context,
      initializeImportMeta(meta) {
        meta.url = "https://extension.invalid/assets/embeddings/worker.mjs"
      }
    })
    await module.link((specifier) => specifier.includes("tokenizers")
      ? new SyntheticModule(["Tokenizer"], function () {
          this.setExport("Tokenizer", class {
            constructor(definition, config) { initialization.push({ definition, config }) }
            encode(text, options) {
              initialization.push({ text, options })
              return { ids: [101, ...Array.from({ length: 260 }, (_, i) => i + 1), 102] }
            }
          })
        }, { context })
      : new SyntheticModule(["env", "Tensor", "InferenceSession"], function () {
          this.setExport("env", env)
          this.setExport("Tensor", Tensor)
          this.setExport("InferenceSession", { create: async (bytes, options) => {
            initialization.push({ bytes: Array.from(new Uint8Array(bytes)), options })
            return { inputNames: ["input_ids", "attention_mask", "token_type_ids"],
              run: async (feeds) => {
                runs.push(Object.fromEntries(Object.entries(feeds).map(([key, value]) =>
                  [key, { type: value.type, dims: value.dims, data: Array.from(value.data, Number) }])))
                const length = feeds.input_ids.dims[1]
                const hidden = new Tensor("float32",
                  Float32Array.from({ length: length * 384 }, (_, i) => i % 384 === 0 ? 3 : i % 384 === 1 ? 4 : 0),
                  [1, length, 384])
                return { last_hidden_state: hidden }
              }
            }
          } })
        }, { context }))
    await module.evaluate()
    self.onmessage({ data: { id: "invalid", text: null } })
    self.onmessage({ data: { id: "cancelled", text: "hello" } })
    self.onmessage({ data: { id: "cancelled", cancel: true } })
    if (${successful}) self.onmessage({ data: { id: "success", text: "hello" } })
    await new Promise(setImmediate)
    process.stdout.write(JSON.stringify({ replies, fetches, reads, runs, initialization, env,
      cleanup: tensors.map(({ type, dims, disposed }) => ({ type, dims, disposed })) }))
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

  it("preserves successful vectors, packaged asset reads and tensor cleanup", () => {
    const original = runWorker(source, true)
    const success = original.replies.find(
      (reply: { id: string }) => reply.id === "success"
    )
    expect(success.vector).toHaveLength(384)
    expect(success.vector[0]).toBeCloseTo(0.6, 12)
    expect(success.vector[1]).toBeCloseTo(0.8, 12)
    expect(success.vector.slice(2)).toEqual(Array(382).fill(0))
    expect(original.fetches).toBe(3)
    expect(original.reads).toEqual([
      "https://extension.invalid/assets/embeddings/model/tokenizer.json",
      "https://extension.invalid/assets/embeddings/model/tokenizer_config.json",
      "https://extension.invalid/assets/embeddings/model/onnx/model_quantized.onnx"
    ])
    expect(original.runs).toHaveLength(2)
    for (const [index, length] of [256, 8].entries()) {
      const feeds = original.runs[index]
      expect(feeds.input_ids).toEqual({
        type: "int64",
        dims: [1, length],
        data: [
          101,
          ...Array.from({ length: length - 2 }, (_, i) => index * 254 + i + 1),
          102
        ]
      })
      expect(feeds.attention_mask.data).toEqual(Array(length).fill(1))
      expect(feeds.token_type_ids.data).toEqual(Array(length).fill(0))
    }
    expect(original.cleanup).toHaveLength(8)
    expect(
      original.cleanup.every(
        (tensor: { disposed: number }) => tensor.disposed === 1
      )
    ).toBe(true)
    expect(original.initialization).toEqual([
      {
        definition: { model: { type: "WordPiece" } },
        config: { model_max_length: 256 }
      },
      {
        bytes: [1, 2, 3],
        options: { executionProviders: ["wasm"], graphOptimizationLevel: "all" }
      },
      { text: "hello", options: { add_special_tokens: true } }
    ])
    expect(original.env.wasm).toEqual({
      numThreads: 1,
      proxy: false,
      wasmPaths: "https://extension.invalid/assets/embeddings/runtime/"
    })
    expect(runWorker(minifyEmbeddingWorker(source), true)).toEqual(original)
  })
})
