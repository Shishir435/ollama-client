import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

/** Exercise the actual store gate; caller environment cannot reclassify its output. */
describe("store debug-symbol check", () => {
  it.each([
    "background.js",
    "chunks/panel.js"
  ])("rejects a debug helper in %s even with the debug flag set", (file) => {
    const directory = mkdtempSync(join(tmpdir(), "agent-store-check-"))
    try {
      mkdirSync(join(directory, "chunks"))
      writeFileSync(join(directory, "manifest.json"), "{}")
      writeFileSync(join(directory, "sidepanel.html"), "<html></html>")
      writeFileSync(join(directory, "options.html"), "<html></html>")
      writeFileSync(
        join(directory, file),
        "globalThis.__agentReport = () => {}"
      )
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          resolve("tools/checks/check-bundle-size.ts"),
          directory,
          "--check"
        ],
        { encoding: "utf8", env: { ...process.env, WXT_AGENT_DEBUG: "1" } }
      )
      expect(result.status).toBe(1)
      expect(result.stderr).toContain(
        "__agentReport is present in a store build"
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
