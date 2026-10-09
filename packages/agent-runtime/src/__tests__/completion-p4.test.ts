import type {
  AgentCompletionCheck,
  AgentEvidenceRecord,
  AgentObservation
} from "@ollama-client/contracts"
import { AgentTaskRequirementSchema } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import { judgeAgentCompletion } from "../completion"
import { agentWriteHeldPlannedValue } from "../completion-support"
import type { AgentStepReadout } from "../ports"
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
  it("does not replace an ambiguous record predicate with a bound field receipt", () => {
    expect(
      judgeAgentCompletion({
        observation: {
          ...page,
          elements: [{ ...page.elements[0], rowContext: "Invoice 1 copy" }]
        },
        requirements: [
          {
            id: "r1",
            kind: "change",
            text: "Name holds Ada",
            check: {
              type: "field",
              name: "Name",
              value: "Ada",
              record: "Invoice 1"
            }
          }
        ],
        outcomes: [{ id: "r1", met: true, evidence: "Ada" }],
        steps: [
          {
            runId: "r",
            stepId: "s",
            sequence: 1,
            status: "verified",
            at: 1,
            requirementId: "r1",
            mutating: true,
            command: {
              type: "clear_and_type",
              ref: "e1",
              snapshotId: "s1",
              generation: 1,
              text: "Ada"
            },
            target: {
              ref: "e1",
              tag: "input",
              name: "Name",
              rowContext: "Invoice 1 copy"
            },
            verification: {
              outcome: "confirmed",
              evidence: {
                kind: "field",
                summary: "Field contains the resolved value",
                observedAt: 1
              }
            }
          }
        ]
      })
    ).toMatchObject({ reason: "needs_review" })
  })
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

  describe("checks that outlive the page they were made on", () => {
    const confirmed = (kind: string) => ({
      outcome: "confirmed" as const,
      evidence: { kind, summary: kind, observedAt: 1 }
    })
    const write = (
      overrides: Partial<AgentStepReadout> = {}
    ): AgentStepReadout => ({
      runId: "r",
      stepId: "s1",
      sequence: 1,
      status: "verified",
      at: 1,
      mutating: true,
      consequential: [],
      requirementId: "r1",
      target: { ref: "e1", tag: "input", name: "Name" },
      verification: confirmed("field"),
      heldPlannedValue: true,
      ...overrides
    })
    const submit = (
      overrides: Partial<AgentStepReadout> = {}
    ): AgentStepReadout => ({
      runId: "r",
      stepId: "s2",
      sequence: 2,
      status: "verified",
      at: 2,
      mutating: true,
      consequential: ["submission"],
      requirementId: "r2",
      target: { ref: "e2", tag: "button", name: "Continue" },
      verification: confirmed("submission"),
      ...overrides
    })
    const leftPage: AgentObservation = {
      ...page,
      url: "https://example.com/details?name=Alice",
      visibleText: "Status: Active",
      elements: []
    }
    const judgeLeft = (steps: AgentStepReadout[]) =>
      judgeAgentCompletion({
        steps,
        observation: leftPage,
        evidenceLedger: [],
        requirements: [
          {
            id: "r1",
            kind: "change",
            text: "The Name field contains Alice",
            check: { type: "field", name: "Name", value: "Alice" }
          }
        ],
        outcomes: [{ id: "r1", met: true }]
      })

    it("credits a field the run filled and then submitted off the page", () => {
      expect(judgeLeft([write(), submit()])).toMatchObject({
        type: "accepted"
      })
    })
    it.each([
      [
        "the write never held the planned value",
        [write({ heldPlannedValue: undefined }), submit()]
      ],
      [
        "only a click came after it, not a submission",
        [
          write(),
          submit({
            consequential: [],
            verification: {
              outcome: "confirmed",
              evidence: {
                kind: "activation",
                summary: "clicked",
                observedAt: 1
              }
            }
          })
        ]
      ],
      ["nothing confirmed moved the page after it", [write()]],
      [
        "an unconfirmed change moved the page",
        [
          write(),
          submit({
            verification: { ...confirmed("submission"), outcome: "ambiguous" }
          })
        ]
      ],
      [
        "the write advanced another requirement",
        [write({ requirementId: "r2" }), submit()]
      ],
      [
        "a later write replaced the value",
        [
          write(),
          write({ stepId: "s3", sequence: 3, heldPlannedValue: undefined }),
          submit({ sequence: 4 })
        ]
      ]
    ] as const)("does not credit a vanished field when %s", (_, steps) => {
      expect(judgeLeft([...steps])).toMatchObject({
        type: "refused",
        reason: "contradicted_state"
      })
    })
    it("records a held value only for the exact confirmed planned result", () => {
      const requirement = {
        id: "r1",
        kind: "change" as const,
        text: "Name is Alice",
        check: { type: "field" as const, name: "Name", value: "Alice" }
      }
      const target = { accessibleName: "Name", expectedValue: "Alice" }
      expect(
        agentWriteHeldPlannedValue(requirement, [target], confirmed("field"))
      ).toBe(true)
      expect(
        agentWriteHeldPlannedValue(
          requirement,
          [{ accessibleName: "Email", expectedValue: "a@b.c" }, target],
          confirmed("fields")
        )
      ).toBe(true)
      expect(
        agentWriteHeldPlannedValue(
          requirement,
          [target, { ...target, expectedValue: "Bob" }],
          confirmed("fields")
        )
      ).toBe(false)
      for (const [req, tgt, verification] of [
        [
          requirement,
          { ...target, expectedValue: "XAlice" },
          confirmed("field")
        ],
        [
          requirement,
          { ...target, accessibleName: "Email" },
          confirmed("field")
        ],
        [requirement, { ...target, sensitive: true }, confirmed("field")],
        [
          {
            ...requirement,
            check: { ...requirement.check, frameId: 1 }
          },
          { ...target, frameId: 0 },
          confirmed("field")
        ],
        [requirement, target, { ...confirmed("field"), outcome: "ambiguous" }],
        [requirement, target, confirmed("activation")],
        [{ ...requirement, check: undefined }, target, confirmed("field")],
        [
          {
            ...requirement,
            check: { ...requirement.check, record: "Invoice 1" }
          },
          target,
          confirmed("field")
        ]
      ] as const)
        expect(agentWriteHeldPlannedValue(req, [tgt], verification)).toBe(false)
    })
    it("credits a field a confirmed batch filled before the submission", () => {
      const batch = write({
        target: { ref: "e1", tag: "input", name: "Email" },
        verification: {
          outcome: "confirmed",
          evidence: {
            kind: "fields",
            summary: "All 2 fields hold the resolved value",
            observedAt: 1,
            fields: [{ name: "Email" }, { name: "Name" }]
          }
        }
      })
      expect(judgeLeft([batch, submit()])).toMatchObject({ type: "accepted" })
      expect(
        judgeLeft([
          batch,
          write({ stepId: "s3", sequence: 3, heldPlannedValue: undefined }),
          submit({ sequence: 4 })
        ])
      ).toMatchObject({ type: "refused", reason: "contradicted_state" })
    })
    it("still contradicts a field present on the page with another value", () => {
      expect(
        judgeAgentCompletion({
          steps: [write(), submit()],
          observation: page,
          evidenceLedger: [],
          requirements: [
            {
              id: "r1",
              kind: "change",
              text: "Name contains Alice",
              check: { type: "field", name: "Name", value: "Alice" }
            }
          ],
          outcomes: [{ id: "r1", met: true }]
        })
      ).toMatchObject({ type: "refused", reason: "contradicted_state" })
    })
  })

  describe("select options named by their label", () => {
    const colors = (value: string) => ({
      ...page,
      elements: [
        {
          ...page.elements[2],
          value,
          options: [
            { value: "red", label: "Red", disabled: false },
            { value: "blue", label: "Blue", disabled: false },
            { value: "grey", label: "Grey", disabled: true }
          ]
        }
      ]
    })
    it.each([
      ["Blue", "blue", true],
      ["blue", "blue", true],
      ["Red", "blue", false],
      ["Green", "blue", false],
      ["Grey", "grey", false]
    ] as const)("checks %s against selected %s", (wanted, value, accepted) => {
      expect(
        judge({ type: "selected", name: "Color", value: wanted }, colors(value))
          .type === "accepted"
      ).toBe(accepted)
    })
  })

  describe("constraints on the keys the run pressed", () => {
    const pressed = (
      key: string,
      overrides: Partial<AgentStepReadout> = {}
    ): AgentStepReadout => ({
      runId: "r",
      stepId: `press-${key}`,
      sequence: 1,
      status: "verified",
      at: 1,
      mutating: true,
      consequential: [],
      requirementId: "r1",
      command: {
        type: "press_key",
        ref: "e1",
        key,
        snapshotId: "s1",
        generation: 1
      },
      verification: {
        outcome: "confirmed",
        evidence: { kind: "keyboard", summary: "moved", observedAt: 1 }
      },
      ...overrides
    })
    const focused: AgentObservation = {
      ...page,
      visibleText: "First Second",
      elements: [
        {
          ref: "e1",
          frameId: 0,
          tag: "input",
          name: "First",
          value: "",
          visible: true,
          sensitive: false,
          enabled: true,
          editable: true
        },
        {
          ref: "e2",
          frameId: 0,
          tag: "input",
          name: "Second",
          value: "",
          focused: true,
          visible: true,
          sensitive: false,
          enabled: true,
          editable: true
        }
      ]
    }
    const judgeKeys = (text: string, steps: AgentStepReadout[]) =>
      judgeAgentCompletion({
        steps,
        observation: focused,
        evidenceLedger: [],
        constraints: [{ id: "c1", text, kind: "scope" }],
        requirements: [
          { id: "r1", kind: "change", text: "Second has keyboard focus" }
        ],
        outcomes: [{ id: "r1", met: true, evidence: "Second" }]
      })
    const constraintReviewed = (
      judgement: ReturnType<typeof judgeAgentCompletion>
    ) =>
      judgement.type === "refused" &&
      (judgement.review?.constraintIds ?? []).includes("c1")

    it("settles a focus move whose planned check answers another question", () => {
      const judgement = judgeAgentCompletion({
        steps: [pressed("Tab")],
        observation: focused,
        evidenceLedger: [],
        requirements: [
          {
            id: "r1",
            kind: "change",
            text: "Keyboard focus is on Second.",
            check: { type: "field", name: "Second", value: "" }
          }
        ],
        outcomes: [{ id: "r1", met: true, evidence: "Second" }]
      })
      expect(judgement).toMatchObject({ type: "accepted" })
      expect(
        judgeAgentCompletion({
          steps: [pressed("Tab")],
          observation: {
            ...focused,
            elements: focused.elements.map((element) => ({
              ...element,
              focused: element.name === "First"
            }))
          },
          evidenceLedger: [],
          requirements: [
            {
              id: "r1",
              kind: "change",
              text: "Keyboard focus is on Second.",
              check: { type: "field", name: "Second", value: "" }
            }
          ],
          outcomes: [{ id: "r1", met: true, evidence: "Second" }]
        })
      ).toMatchObject({ type: "refused", reason: "needs_review" })
    })
    it("needs no review when every change was a confirmed press of the named key", () => {
      expect(
        constraintReviewed(
          judgeKeys("Move focus from First to Second using Tab.", [
            pressed("Tab")
          ])
        )
      ).toBe(false)
    })
    it.each([
      ["another key was pressed", "Move focus using Tab.", [pressed("Enter")]],
      [
        "the press was not confirmed",
        "Move focus using Tab.",
        [
          pressed("Tab", {
            verification: {
              outcome: "ambiguous",
              evidence: { kind: "keyboard", summary: "?", observedAt: 1 }
            }
          })
        ]
      ],
      [
        "a click changed the page too",
        "Move focus using Tab.",
        [
          pressed("Tab"),
          pressed("Tab", {
            stepId: "click",
            sequence: 2,
            command: {
              type: "click",
              ref: "e2",
              snapshotId: "s1",
              generation: 1
            }
          })
        ]
      ],
      [
        "the constraint names no key",
        "Move focus only within this form.",
        [pressed("Tab")]
      ],
      [
        "the key is only part of a word",
        "Move focus using Tabs panel.",
        [pressed("Tab")]
      ],
      ["the limit forbids that key", "Do not press Tab.", [pressed("Tab")]],
      ["the limit counts presses", "Press Tab at most once.", [pressed("Tab")]]
    ] as const)("still reviews the constraint when %s", (_, text, steps) => {
      expect(constraintReviewed(judgeKeys(text, [...steps]))).toBe(true)
    })
  })

  describe("limits that only restate when to stop", () => {
    const selected = (
      overrides: Partial<AgentStepReadout> = {}
    ): AgentStepReadout => ({
      runId: "r",
      stepId: "pick",
      sequence: 1,
      status: "verified",
      at: 1,
      mutating: true,
      consequential: [],
      requirementId: "r1",
      target: { ref: "e3", tag: "select", name: "Color" },
      verification: {
        outcome: "confirmed",
        evidence: { kind: "field", summary: "held", observedAt: 1 }
      },
      ...overrides
    })
    const judgeStop = (text: string, steps: AgentStepReadout[]) =>
      judgeAgentCompletion({
        steps,
        observation: page,
        evidenceLedger: [],
        constraints: [{ id: "c1", text, kind: "limit" }],
        requirements: [
          {
            id: "r1",
            kind: "change",
            text: "Blue is selected from Color.",
            check: { type: "selected", name: "Color", value: "Blue" }
          }
        ],
        outcomes: [{ id: "r1", met: true }]
      })

    it.each([
      "Stop once Blue is selected.",
      "Finish when Blue is selected in Color"
    ])("settles %s when that outcome is met and nothing followed", (text) => {
      expect(judgeStop(text, [selected()])).toMatchObject({ type: "accepted" })
    })
    it.each([
      [
        "the run acted again after it",
        "Stop once Blue is selected.",
        [
          selected(),
          selected({ stepId: "more", sequence: 2, requirementId: "r2" })
        ]
      ],
      ["it names something else", "Stop once Red is selected.", [selected()]],
      ["it is not a stop condition", "Only select Blue.", [selected()]],
      ["this run changed nothing", "Stop once Blue is selected.", []]
    ] as const)("leaves it to review when %s", (_, text, steps) => {
      expect(judgeStop(text, [...steps])).toMatchObject({
        type: "refused",
        reason: "needs_review"
      })
    })
  })

  describe("a page opened in a new tab", () => {
    const detailsUrl = "https://example.com/open_tab/details"
    const opened = (
      overrides: Partial<AgentStepReadout> = {}
    ): AgentStepReadout => ({
      runId: "r",
      stepId: "open",
      sequence: 1,
      status: "verified",
      at: 1,
      mutating: false,
      consequential: [],
      requirementId: "r1",
      command: {
        type: "open_tab",
        url: detailsUrl,
        snapshotId: "s1",
        generation: 1
      },
      verification: {
        outcome: "confirmed",
        evidence: {
          kind: "tab",
          summary: "Destination committed",
          observedAt: 1
        }
      },
      ...overrides
    })
    const onDetails: AgentObservation = {
      ...page,
      url: detailsUrl,
      title: "Details",
      visibleText: "Status: Active",
      elements: []
    }
    const judgeTab = (
      text: string,
      steps: AgentStepReadout[],
      observation = onDetails
    ) =>
      judgeAgentCompletion({
        steps,
        observation,
        evidenceLedger: [],
        requirements: [{ id: "r1", kind: "change", text }],
        outcomes: [{ id: "r1", met: true, evidence: "Status: Active" }]
      })

    it("is met by the run's confirmed open_tab receipt for it", () => {
      expect(
        judgeTab("Details is open in a new tab.", [opened()])
      ).toMatchObject({ type: "accepted" })
      /** The model often tags no requirement; the page binds it instead. */
      expect(
        judgeTab("Details is open in a new tab.", [
          opened({ requirementId: undefined })
        ])
      ).toMatchObject({ type: "accepted" })
    })
    it.each([
      [
        "the receipt served another requirement",
        "Details is open in a new tab.",
        [opened({ requirementId: "r2" })],
        onDetails
      ],
      [
        "the open was not confirmed",
        "Details is open in a new tab.",
        [
          opened({
            verification: {
              outcome: "ambiguous",
              evidence: { kind: "tab", summary: "?", observedAt: 1 }
            }
          })
        ],
        onDetails
      ],
      [
        "the run is no longer on that page",
        "Details is open in a new tab.",
        [opened()],
        { ...onDetails, url: "https://example.com/elsewhere" }
      ],
      [
        "the requirement claims more than the open",
        "Details is open in a new tab and saved.",
        [opened()],
        onDetails
      ]
    ] as const)("is not met when %s", (_, text, steps, observation) => {
      expect(judgeTab(text, [...steps], observation).type).not.toBe("accepted")
    })
  })
})
