import { readFileSync } from "node:fs"
import path from "node:path"
import { AGENT_PAGE_LEAVING_ACTIVATIONS } from "@ollama-client/agent-runtime"
import { describe, expect, it } from "vitest"

/**
 * Completion credits a field the run filled and then left by a followed link
 * by reading the verifier's own sentence for that click. The two live in
 * different packages, so a reworded summary would silently drop the credit:
 * every sentence completion relies on must still be one the verifier emits.
 */
describe("page-leaving activation summaries", () => {
  it("are all sentences the effect verifier still composes", () => {
    const verifier = readFileSync(
      path.resolve(process.cwd(), "src/lib/browser-agent/effect-verifier.ts"),
      "utf8"
    )
    for (const summary of AGENT_PAGE_LEAVING_ACTIVATIONS)
      expect(verifier).toContain(`"${summary}"`)
  })
})
