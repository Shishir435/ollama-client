import { describe, expect, it } from "vitest"

import { agentRunResult } from "../run-result"

const read = { id: "r1", text: "Report the status code", kind: "read" as const }

describe("agentRunResult", () => {
  /**
   * gpt-6-luna completed "report the status code" with the summary "Opened
   * Details and found the status code." and the evidence "Status code:
   * ZX-482"; only the summary was kept, and the chat told the user the code
   * was not in the result.
   */
  it("adds what a met read requirement quoted when the summary omits it", () => {
    expect(
      agentRunResult(
        "Opened Details and found the status code.",
        [read],
        [{ id: "r1", met: true, evidence: "Status code: ZX-482" }],
        ["r1"]
      )
    ).toBe("Opened Details and found the status code.\nStatus code: ZX-482")
  })

  it("keeps the summary alone when it already states the finding", () => {
    expect(
      agentRunResult(
        "The status code is ZX-482.",
        [read],
        [{ id: "r1", met: true, evidence: "ZX-482" }],
        ["r1"]
      )
    ).toBe("The status code is ZX-482.")
  })

  it("adds nothing for unmet reads or change requirements", () => {
    const change = { id: "r2", text: "Name is Alice", kind: "change" as const }
    expect(
      agentRunResult(
        "Done.",
        [read, change],
        [
          { id: "r1", met: false, evidence: "Status code: ZX-482" },
          { id: "r2", met: true, evidence: "Alice" }
        ],
        ["r2"]
      )
    ).toBe("Done.")
  })
})
