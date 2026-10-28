import { readFileSync } from "node:fs"
import path from "node:path"
import {
  AGENT_EVIDENCE_CODES,
  agentEvidenceCode,
  agentEvidenceLeftPage,
  agentEvidenceOpenedTab
} from "@ollama-client/agent-runtime"
import { describe, expect, it } from "vitest"

/**
 * Completion credits a field the run filled and then left by a followed link
 * by reading what the verifier says that click did. The two live in different
 * packages, so the verdict travels as a code both sides name; a reworded
 * summary changes what a person reads and nothing a run decides.
 */
describe("verifier evidence codes", () => {
  it("are all codes the effect verifier still emits", () => {
    const verifier = readFileSync(
      path.resolve(process.cwd(), "src/lib/browser-agent/effect-verifier.ts"),
      "utf8"
    )
    for (const code of AGENT_EVIDENCE_CODES)
      expect(verifier).toContain(`"${code}"`)
  })

  it("read the wording receipts carried before the code existed", () => {
    expect(agentEvidenceCode({ summary: "Control opened a new tab" })).toBe(
      "opened_new_tab"
    )
    expect(
      agentEvidenceCode({ summary: "Authorized destination is committed" })
    ).toBe("destination_committed")
    expect(
      agentEvidenceCode({
        summary: "The site redirected its own link within its origin"
      })
    ).toBe("same_origin_redirect")
    expect(agentEvidenceCode({ summary: "Anything else" })).toBeUndefined()
    /** A code outranks the wording beside it. */
    expect(
      agentEvidenceCode({
        code: "page_handled_link",
        summary: "Control opened a new tab"
      })
    ).toBe("page_handled_link")
  })

  it("counts a router that moved the tab itself as having left the page", () => {
    const left = (code: (typeof AGENT_EVIDENCE_CODES)[number]) =>
      agentEvidenceLeftPage({ code, summary: "" })
    expect(left("page_navigated_itself")).toBe(true)
    expect(left("destination_committed")).toBe(true)
    expect(left("same_origin_redirect")).toBe(true)
    expect(left("opened_new_tab")).toBe(true)
    /** A page that handled the click itself and stayed did not. */
    expect(left("page_handled_link")).toBe(false)
    expect(
      agentEvidenceOpenedTab({ code: "opened_new_tab", summary: "" })
    ).toBe(true)
    expect(
      agentEvidenceOpenedTab({ code: "page_navigated_itself", summary: "" })
    ).toBe(false)
  })
})
