import { describe, expect, it } from "vitest"
import { agentRowContextBeyond } from "../row-context"

describe("agentRowContextBeyond", () => {
  it("drops the control's own label from its row", () => {
    expect(agentRowContextBeyond("Delete", "old-report-2023.pdf Delete")).toBe(
      "old-report-2023.pdf"
    )
  })

  it("removes the label once and only as a whole word", () => {
    expect(
      agentRowContextBeyond("Delete", "Deleted items.txt Delete Delete")
    ).toBe("Deleted items.txt Delete")
  })

  it("treats the label literally", () => {
    expect(agentRowContextBeyond("(x)", "notes.md (x)")).toBe("notes.md")
  })

  it("keeps a row the label does not appear in", () => {
    expect(agentRowContextBeyond("Remove", "report.pdf")).toBe("report.pdf")
  })

  it("says nothing when the row is only the label", () => {
    expect(agentRowContextBeyond("Delete", " Delete ")).toBeUndefined()
    expect(agentRowContextBeyond("Delete", undefined)).toBeUndefined()
  })
})
