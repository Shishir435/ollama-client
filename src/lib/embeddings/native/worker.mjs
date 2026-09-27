import * as ort from "./runtime/ort.wasm.min.mjs"
import { Tokenizer } from "./runtime/tokenizers.mjs"

/** Single CPU thread inside an explicit local worker avoids blob proxy workers. */
ort.env.wasm.numThreads = 1
ort.env.wasm.proxy = false
ort.env.wasm.wasmPaths = new URL("./runtime/", import.meta.url).href
let session
let tokenizer
/** Relative URLs read files shipped inside the extension, never a remote model server. */
const json = async (name) => {
  const response = await fetch(new URL(`./model/${name}`, import.meta.url))
  if (!response.ok) throw new Error(`Missing ${name}`)
  return response.json()
}
async function initialize() {
  if (session) return
  const [definition, config] = await Promise.all([
    json("tokenizer.json"),
    json("tokenizer_config.json")
  ])
  tokenizer = new Tokenizer(definition, config)
  const response = await fetch(
    new URL("./model/onnx/model_quantized.onnx", import.meta.url)
  )
  if (!response.ok) throw new Error("Bundled model unavailable")
  session = await ort.InferenceSession.create(await response.arrayBuffer(), {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all"
  })
}
async function embedWindow(ids) {
  const length = ids.length
  const tensor = (values) =>
    new ort.Tensor("int64", BigInt64Array.from(values, BigInt), [1, length])
  const feeds = {
    input_ids: tensor(ids),
    attention_mask: tensor(ids.map(() => 1))
  }
  if (session.inputNames.includes("token_type_ids"))
    feeds.token_type_ids = tensor(ids.map(() => 0))
  let outputs = {}
  try {
    outputs = await session.run(feeds)
    const hidden = outputs.last_hidden_state
    if (!hidden || hidden.dims.length !== 3 || hidden.dims[2] !== 384)
      throw new Error("Unexpected model output")
    const vector = new Array(384).fill(0)
    // All tokens have mask=1 because this experiment does one unpadded sequence at a time.
    for (let t = 0; t < length; t++)
      for (let d = 0; d < 384; d++)
        vector[d] += Number(hidden.data[t * 384 + d]) / length
    const norm = Math.hypot(...vector)
    if (!Number.isFinite(norm) || norm === 0)
      throw new Error("Invalid embedding")
    for (let d = 0; d < 384; d++) vector[d] /= norm
    return vector
  } finally {
    for (const value of Object.values(feeds)) value.dispose()
    for (const value of Object.values(outputs)) value.dispose()
  }
}
/** Cover every token, including long saved chunks, without changing stored text. */
async function embed(text, id) {
  const encoded = tokenizer.encode(text, { add_special_tokens: true }).ids
  const tokens = encoded.slice(1, -1)
  const vector = new Array(384).fill(0)
  for (let offset = 0; offset < Math.max(1, tokens.length); offset += 254) {
    if (cancelled.has(id)) throw new Error("Cancelled")
    const window = tokens.slice(offset, offset + 254)
    const row = await embedWindow([encoded[0], ...window, encoded.at(-1)])
    const weight = Math.max(1, window.length)
    for (let d = 0; d < 384; d++) vector[d] += row[d] * weight
  }
  const norm = Math.hypot(...vector)
  if (!Number.isFinite(norm) || norm === 0) throw new Error("Invalid embedding")
  return vector.map((value) => value / norm)
}
const requests = new Set()
const cancelled = new Set()
let queue = Promise.resolve()
self.onmessage = ({ data }) => {
  if (data.cancel) {
    if (requests.has(data.id)) cancelled.add(data.id)
    return
  }
  requests.add(data.id)
  queue = queue.then(async () => {
    try {
      if (typeof data.text !== "string" || data.text.length > 200000)
        throw new Error("Invalid input")
      if (cancelled.has(data.id)) throw new Error("Cancelled")
      await initialize()
      self.postMessage({ id: data.id, vector: await embed(data.text, data.id) })
    } catch {
      self.postMessage({
        id: data.id,
        error: "Bundled embedding generation failed"
      })
    } finally {
      requests.delete(data.id)
      cancelled.delete(data.id)
    }
  })
}
