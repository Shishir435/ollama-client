import type {
  AgentCompletionCheck,
  AgentEvidenceRecord,
  AgentObservation
} from "@ollama-client/contracts"
import { AgentTaskRequirementSchema } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import { judgeAgentCompletion } from "../completion"
import { agentRunResult } from "../run-result"

const page: AgentObservation = {
  snapshotId: "s1",
  generation: 1,
  tabId: 7,
  frameId: 0,
  documentId: "d1",
  url: "https://example.com/invoice/1?view=draft",
  origin: "https://example.com",
  title: "Invoice 1",
  visibleText: "Invoice 1 saved",
  frames: [
    {
      frameId: 0,
      documentId: "d1",
      snapshotId: "s1",
      generation: 1,
      origin: "https://example.com",
      url: "https://example.com/invoice/1?view=draft",
      access: "ok"
    }
  ],
  elements: [
    {
      ref: "e1",
      frameId: 0,
      tag: "input",
      name: "Name",
      value: "Ada",
      visible: true,
      sensitive: false,
      enabled: true,
      editable: false,
      rowContext: "Invoice 1"
    },
    {
      ref: "e2",
      frameId: 0,
      tag: "input",
      name: "Agree",
      checked: true,
      visible: true,
      sensitive: false,
      enabled: true,
      editable: false
    },
    {
      ref: "e3",
      frameId: 0,
      tag: "select",
      name: "Color",
      value: "blue",
      visible: true,
      sensitive: false,
      enabled: true,
      editable: false,
      options: [{ value: "blue", label: "Blue", disabled: false }]
    },
    {
      ref: "e4",
      frameId: 0,
      tag: "div",
      role: "status",
      name: "Invoice 1 saved",
      visible: true,
      sensitive: false,
      enabled: true,
      editable: false
    }
  ],
  dialogs: [],
  capturedAt: 1,
  scroll: {
    x: 0,
    y: 0,
    viewportWidth: 100,
    viewportHeight: 100,
    documentWidth: 100,
    documentHeight: 100
  }
}
const fact = (
  quote: string,
  overrides: Partial<AgentEvidenceRecord> = {}
): AgentEvidenceRecord => ({
  id: "fact",
  kind: "observed_fact",
  validity: "current",
  observedAt: 1,
  quote,
  source: {
    tabId: 7,
    frameId: 0,
    documentId: "d1",
    snapshotId: "s1",
    generation: 1,
    origin: "https://example.com"
  },
  ...overrides
})
const judge = (
  check?: AgentCompletionCheck,
  observation = page,
  evidence = "Invoice 1 saved",
  ledger = [fact(evidence)]
) =>
  judgeAgentCompletion({
    steps: [],
    observation,
    evidenceLedger: ledger,
    requirements: [
      {
        id: "r1",
        kind: "change",
        text: !check
          ? "Invoice 1 is saved"
          : check.type === "checked"
            ? `${check.name} is ${check.checked ? "checked" : "unchecked"}`
            : check.type === "field" || check.type === "selected"
              ? `${check.name} holds ${check.value}`
              : check.type === "url"
                ? `Open ${check.url}`
                : check.type === "row"
                  ? `${check.record} exists`
                  : `${check.record} is ${check.state}`,
        ...(check ? { check } : {})
      }
    ],
    outcomes: [{ id: "r1", met: true, evidence }]
  })

describe("P4 deterministic completion", () => {
  it("does not substitute a satisfied checkbox predicate for saving an invoice", () => {
    expect(
      judgeAgentCompletion({
        steps: [],
        observation: page,
        requirements: [
          {
            id: "r1",
            text: "Invoice 1 is saved",
            kind: "change",
            check: { type: "checked", name: "Agree", checked: true }
          }
        ],
        outcomes: [{ id: "r1", met: true }]
      })
    ).toMatchObject({ reason: "needs_review" })
  })

  it("can complete a correctly checked checkbox without quoting text or clicking again", () => {
    expect(
      judge({ type: "checked", name: "Agree", checked: true }, page, "")
    ).toMatchObject({ type: "accepted" })
  })

  it("routes prose about saving to review even when it names the exact invoice", () => {
    expect(
      judge(
        { type: "record_state", record: "Invoice 1", state: "saved" },
        {
          ...page,
          elements: page.elements.filter((element) => element.role !== "status")
        }
      )
    ).toMatchObject({ reason: "needs_review" })
  })
  it("treats an unrelated new quote as needs-review rather than a saved invoice", () => {
    expect(
      judge(
        undefined,
        { ...page, visibleText: "Help menu expanded" },
        "Help menu expanded"
      )
    ).toMatchObject({ type: "refused", reason: "needs_review" })
  })
  it("requires independent support for reads, including after recovery", () => {
    const input = {
      steps: [],
      observation: page,
      requirements: [
        { id: "r1", text: "Report the invoice status", kind: "read" as const }
      ],
      outcomes: [{ id: "r1", met: true, evidence: "Invoice 1 saved" }]
    }
    expect(
      judgeAgentCompletion({ ...input, outcomes: [{ id: "r1", met: true }] })
    ).toMatchObject({ reason: "missing_evidence" })
    for (const kind of [
      "agent_input",
      "user_input",
      "model_inference",
      "page_tool_claim",
      "verified_effect"
    ] as const)
      expect(
        judgeAgentCompletion({
          ...input,
          evidenceLedger: [fact("Invoice 1 saved", { kind })]
        })
      ).toMatchObject({ type: "refused" })
    for (const validity of [
      "requires_refresh",
      "incomplete",
      "superseded"
    ] as const)
      expect(
        judgeAgentCompletion({
          ...input,
          evidenceLedger: [fact("Invoice 1 saved", { validity })]
        })
      ).toMatchObject({ type: "refused" })
    expect(
      judgeAgentCompletion({
        ...input,
        evidenceLedger: JSON.parse(
          JSON.stringify([fact("Invoice 1 saved", { validity: "historical" })])
        )
      })
    ).toMatchObject({ type: "accepted" })
  })
  it("checks the exact record identity and a grounded current save state", () => {
    const check = {
      type: "record_state",
      record: "Invoice 1",
      state: "saved"
    } as const
    expect(judge(check)).toMatchObject({ type: "accepted" })
    for (const quote of [
      "Invoice 2 saved",
      "Invoice 1 not saved",
      "Invoice 1 saving",
      "Help menu expanded"
    ])
      expect(
        judge(check, { ...page, visibleText: quote }, quote)
      ).toMatchObject({ type: "refused" })
    expect(
      judge(check, page, "Invoice 1 saved", [
        fact("Invoice 1 saved", { validity: "historical" })
      ])
    ).toMatchObject({ type: "refused" })
    expect(
      judge(check, page, "Invoice 1 saved", [
        fact("Invoice 1 saved", {
          source: {
            tabId: 8,
            frameId: 0,
            documentId: "d1",
            snapshotId: "s1",
            generation: 1,
            origin: "https://example.com"
          }
        })
      ])
    ).toMatchObject({ type: "refused" })
  })
  it.each([
    [{ type: "field", name: "Name", value: "Ada", record: "Invoice 1" }, false],
    [{ type: "field", name: "Name", value: "Ada", record: "Invoice 2" }, false],
    [{ type: "field", name: "Name", value: "Alice" }, false],
    [{ type: "checked", name: "Agree", checked: true }, true],
    [{ type: "checked", name: "Agree", checked: false }, false],
    [{ type: "selected", name: "Color", value: "blue" }, true],
    [{ type: "selected", name: "Color", value: "red" }, false],
    [{ type: "url", url: page.url }, true],
    [
      { type: "url", url: "https://example.com/invoice/1?view=submitted" },
      false
    ],
    [{ type: "row", record: "Invoice 1" }, false],
    [{ type: "row", record: "Invoice 10" }, false]
  ] as const)("checks observable predicate %j", (check, accepted) => {
    expect(judge(check).type === "accepted").toBe(accepted)
  })
  it("requires review for record identity inferred from whole-row text", () => {
    for (const rowContext of [
      "Invoice 1",
      "Invoice 1 copy",
      "Invoice 1 Name Ada"
    ]) {
      const observation = {
        ...page,
        elements: [{ ...page.elements[0], rowContext }]
      }
      for (const check of [
        { type: "row", record: "Invoice 1" },
        { type: "field", record: "Invoice 1", name: "Name", value: "Ada" },
        { type: "checked", record: "Invoice 1", name: "Name", checked: true },
        { type: "selected", record: "Invoice 1", name: "Name", value: "Ada" }
      ] as const)
        expect(judge(check, observation)).toMatchObject({
          reason: "needs_review"
        })
    }
  })
  it("requires the whole row label to match the record", () => {
    const check = { type: "row", record: "Invoice 1" } as const
    const row = {
      ...page.elements[0],
      tag: "tr",
      role: "row",
      rowContext: undefined
    }
    expect(
      judge(check, { ...page, elements: [{ ...row, name: "Invoice 1" }] })
    ).toMatchObject({ type: "accepted" })
    expect(
      judge(check, { ...page, elements: [{ ...row, name: "Invoice 1 copy" }] })
    ).toMatchObject({ reason: "needs_review" })
  })
  it("does not use an unrelated row as a save-status indicator", () => {
    expect(
      judge(
        { type: "record_state", record: "Invoice 1", state: "saved" },
        {
          ...page,
          elements: [
            {
              ...page.elements[3],
              role: undefined,
              rowContext: "Invoice 1 copy"
            }
          ]
        }
      )
    ).toMatchObject({ reason: "needs_review" })
  })
  it("refuses ambiguous and truncated fields even when their prefixes match", () => {
    const check = { type: "field", name: "Name", value: "Ada" } as const
    expect(
      judge(check, {
        ...page,
        elements: [page.elements[0], { ...page.elements[0], ref: "e4" }]
      })
    ).toMatchObject({ type: "refused" })
    expect(
      judge(check, {
        ...page,
        elements: [{ ...page.elements[0], valueTruncated: true }]
      })
    ).toMatchObject({ type: "refused" })
  })
  it("cannot complete after violating do-not-submit", () => {
    expect(
      judgeAgentCompletion({
        steps: [
          {
            runId: "r",
            stepId: "s",
            sequence: 1,
            status: "verified",
            at: 1,
            consequential: ["submission"]
          }
        ],
        observation: page,
        constraints: [
          {
            id: "c1",
            text: "Do not submit",
            kind: "exclude",
            forbids: ["submission"]
          }
        ],
        requirements: [
          {
            id: "r1",
            text: "Name is Ada",
            kind: "change",
            check: { type: "field", name: "Name", value: "Ada" }
          }
        ],
        outcomes: [{ id: "r1", met: true }]
      })
    ).toMatchObject({ type: "refused" })
  })
  it("retains compatible decoding for older plans", () => {
    expect(
      AgentTaskRequirementSchema.parse({
        id: "r1",
        text: "Save the invoice",
        kind: "change"
      }).check
    ).toBeUndefined()
  })
  it("does not relay unsupported success from the model summary", () => {
    const report = agentRunResult(
      "Saved everything and sent the invoice",
      [
        { id: "r1", text: "Name is Ada", kind: "change" },
        { id: "r2", text: "Invoice is submitted", kind: "change" }
      ],
      [
        { id: "r1", met: true },
        { id: "r2", met: false }
      ],
      ["r1"]
    )
    expect(report).toBe(
      "Verified: Name is Ada\nNot verified: Invoice is submitted"
    )
  })
})
