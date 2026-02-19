import { cpSync, existsSync, mkdirSync, statSync } from "fs"
import { dirname, resolve } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = resolve(__dirname, "..")

const srcDir = resolve(rootDir, "node_modules/@xenova/transformers/dist")
const destDir = resolve(rootDir, "public/assets/onnxruntime")

const files = [
  "ort-wasm.wasm",
  "ort-wasm-simd.wasm",
  "ort-wasm-threaded.wasm",
  "ort-wasm-simd-threaded.wasm"
]

console.log("Copying ONNX Runtime WASM files...")

if (!existsSync(srcDir)) {
  console.error(`Source directory not found: ${srcDir}`)
  console.error("Make sure @xenova/transformers is installed: pnpm install")
  process.exit(1)
}

if (!existsSync(destDir)) {
  mkdirSync(destDir, { recursive: true })
}

let copiedCount = 0
for (const file of files) {
  const src = resolve(srcDir, file)
  const dest = resolve(destDir, file)
  if (existsSync(src)) {
    cpSync(src, dest)
    const sizeMB = (statSync(src).size / (1024 * 1024)).toFixed(1)
    console.log(`  ✓ ${file} (${sizeMB} MB)`)
    copiedCount++
  } else {
    console.warn(`  ✗ ${file} not found in ${srcDir}`)
  }
}

console.log(`\nCopied ${copiedCount}/${files.length} files to ${destDir}`)
console.log("ONNX Runtime assets ready for transformers.js reranker!")
