/** Exercise the actual helper in an MV3 isolated content script, in Chromium. */
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { chromium } from "playwright"
import ts from "typescript"

const run = async () => {
  const root = mkdtempSync(join(tmpdir(), "extraction-inert-"))
  let probes = 0
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/probe")) probes++
    response.setHeader("Content-Type", "text/html")
    response.end(
      "<!doctype html><title>Inert extraction regression</title><p>Fixture</p>"
    )
  })
  try {
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
    const { port } = server.address() as AddressInfo
    writeFileSync(
      join(root, "manifest.json"),
      JSON.stringify({
        manifest_version: 3,
        name: "Extraction regression",
        version: "1.0",
        content_scripts: [
          {
            matches: ["http://127.0.0.1/*"],
            js: ["content.js"],
            run_at: "document_idle"
          }
        ]
      })
    )
    const compile = (path: string) =>
      ts.transpileModule(readFileSync(path, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022
        }
      }).outputText
    writeFileSync(
      join(root, "content.js"),
      `
    const modules = {
      "@/lib/text-utils": (exports, require) => {${compile(resolve("src/lib/text-utils.ts"))}},
      "helper": (exports, require) => {${compile(resolve("src/contents/extraction-helpers.ts"))}}
    };
    const require = name => {const exports = {}; modules[name](exports, require); return exports;};
    const {htmlToPlainText} = require("helper");
    document.documentElement.dataset.extracted = htmlToPlainText(${JSON.stringify(`<p>Decoded &amp; safe</p><img src="http://127.0.0.1:${port}/probe" onerror="document.documentElement.dataset.executed='yes'">`)});
  `
    )
    const context = await chromium.launchPersistentContext(
      join(root, "profile"),
      {
        channel: "chromium",
        headless: true,
        args: [
          `--disable-extensions-except=${root}`,
          `--load-extension=${root}`
        ]
      }
    )
    try {
      const page = await context.newPage()
      await page.goto(`http://127.0.0.1:${port}/`)
      await page.waitForFunction(
        () => document.documentElement.dataset.extracted !== undefined
      )
      await page.waitForTimeout(250)
      const state = await page.evaluate(() => ({
        text: document.documentElement.dataset.extracted,
        executed: document.documentElement.dataset.executed
      }))
      assert.equal(state.text, "Decoded & safe")
      assert.equal(state.executed, undefined)
      assert.equal(probes, 0)
      console.log(
        "PASS: MV3 extraction decoded HTML without handlers or resource requests"
      )
    } finally {
      await context.close()
    }
  } finally {
    await new Promise<void>((done) => server.close(() => done()))
    rmSync(root, { recursive: true, force: true })
  }
}
void run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
