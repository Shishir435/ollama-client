import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

/** Only build time downloads; a release always contains verified model bytes. */
const revision = "751bff37182d3f1213fa05d7196b954e230abad9"
const files = {
  "onnx/model_quantized.onnx":
    "afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1",
  "tokenizer.json":
    "da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0",
  "tokenizer_config.json":
    "9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3",
  "README.md":
    "63ea99bf681a2e9eda4f6a537d5ed8fda95d1677111656da37e9cfd080c3af02"
}
export async function prepareBundledEmbeddings() {
  const directory = resolve(".cache/bundled-embeddings")
  const runtime = JSON.parse(
    await readFile(resolve("node_modules/onnxruntime-web/package.json"), "utf8")
  )
  if (runtime.version !== "1.30.0")
    throw new Error(
      "Update the pinned ONNX notices when upgrading onnxruntime-web"
    )
  const assets = Object.entries(files).map(([file, expected]) => ({
    file,
    expected,
    url: `https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/${revision}/${file}`,
    relativeDest: `assets/embeddings/model/${file}`
  }))
  assets.push({
    file: "licenses/onnxruntime-ThirdPartyNotices.txt",
    expected:
      "143764b952fdb1a7c69ce653bfba74a7744d6a8a573bfb73e235fba356c83de3",
    url: "https://raw.githubusercontent.com/microsoft/onnxruntime/v1.30.0/ThirdPartyNotices.txt",
    relativeDest: "assets/embeddings/licenses/onnxruntime-ThirdPartyNotices.txt"
  })
  for (const { file, expected, url } of assets) {
    const destination = resolve(directory, file)
    let bytes = await readFile(destination).catch(() => undefined)
    const valid = (value: Buffer | undefined) =>
      value && createHash("sha256").update(value).digest("hex") === expected
    if (!valid(bytes)) {
      const response = await fetch(url, { signal: AbortSignal.timeout(120000) })
      if (!response.ok)
        throw new Error(`Could not fetch bundled embedding asset: ${file}`)
      bytes = Buffer.from(await response.arrayBuffer())
      if (!valid(bytes))
        throw new Error(`Bundled embedding checksum mismatch: ${file}`)
      await mkdir(resolve(destination, ".."), { recursive: true })
      await writeFile(destination, bytes)
    }
  }
  return assets.map(({ file, relativeDest }) => ({
    absoluteSrc: resolve(directory, file),
    relativeDest
  }))
}
