import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  poll,
  verifyCall,
  withExtensionHarness
} from "../verify/lib/chromium-extension-harness"

const arg = (name: string, fallback: string) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3) ?? fallback
const buildPath = resolve(arg("build", "build/chrome-mv3-benchmark"))
const output = resolve(arg("output", "artifacts/retrieval/benchmark.json"))
const sizes = arg("sizes", "1000,5000").split(",").map(Number)
const samples = Number(arg("samples", "15"))
withExtensionHarness({
  buildPath,
  page: "persistence-verify.html",
  body: async ({ page }) => {
    await poll(
      () => page.evaluate(verifyCall("backendMarker")),
      (marker) =>
        !!marker &&
        typeof marker === "object" &&
        Reflect.get(marker, "backend") === "opfs",
      "production OPFS owner"
    )
    const result = await page.evaluate(
      verifyCall(
        process.argv.includes("--quality")
          ? "retrievalQuality"
          : "retrievalBenchmark",
        ...(process.argv.includes("--quality") ? [] : [sizes, samples])
      )
    )
    const report = {
      revision: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8"
      }).trim(),
      buildPath,
      sourceLabel: arg("label", "working-tree"),
      fixtureSha256: createHash("sha256")
        .update(
          readFileSync(
            resolve("src/entrypoints/persistence-verify/retrieval-benchmark.ts")
          )
        )
        .digest("hex"),
      browser: await page.evaluate("navigator.userAgent"),
      measuredAt: new Date().toISOString(),
      node: process.version,
      platform: process.platform,
      result
    }
    mkdirSync(resolve(output, ".."), { recursive: true })
    writeFileSync(output, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  }
}).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
