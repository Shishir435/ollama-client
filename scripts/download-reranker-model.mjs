import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { dirname, resolve } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = resolve(__dirname, "..")

const HF_BASE = "https://huggingface.co"
const MODEL_NAME = "Xenova/distilbert-base-uncased-finetuned-sst-2-english"
const MODEL_PATH = "onnx"
const destDir = resolve(
  rootDir,
  "public/assets/models",
  MODEL_NAME.replace("/", "-")
)

const files = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.txt",
  "model.onnx",
  "model_quantized.onnx"
]

console.log(`Downloading reranker model: ${MODEL_NAME}`)
console.log(`Destination: ${destDir}`)

if (!existsSync(destDir)) {
  mkdirSync(destDir, { recursive: true })
}

async function downloadFile(filename) {
  const url = `${HF_BASE}/${MODEL_NAME}/resolve/main/${filename}`
  const dest = resolve(destDir, filename)

  if (existsSync(dest)) {
    console.log(`  ✓ ${filename} (already exists)`)
    return
  }

  console.log(`  Downloading ${filename}...`)

  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const buffer = await response.arrayBuffer()
    writeFileSync(dest, Buffer.from(buffer))
    console.log(`  ✓ ${filename}`)
  } catch (error) {
    console.warn(`  ✗ ${filename}: ${error.message}`)
  }
}

console.log("\nDownloading model files...")
await Promise.all(files.map(downloadFile))

console.log(`\nModel files saved to: ${destDir}`)
console.log("Reranker model ready!")
