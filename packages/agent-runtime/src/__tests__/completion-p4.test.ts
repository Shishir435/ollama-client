import type {
  AgentCompletionCheck,
  AgentEvidenceRecord,
  AgentObservation
} from "@ollama-client/contracts"
import { AgentTaskRequirementSchema } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import { judgeAgentCompletion } from "../completion"
import {
  agentWriteHeldPlannedValue,
  checkCompletionState
} from "../completion-support"
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
  check?: Exclude<AgentCompletionCheck, { type: "control_transition" }>,
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

  describe("a read verified only when its quote answers what was asked", () => {
    const plans: AgentObservation = {
      ...page,
      visibleText: "Basic $9 per month Pro $29 per month",
      elements: [
        {
          ref: "b1",
          frameId: 0,
          tag: "button",
          name: "Choose",
          rowContext: "Basic $9 per month Choose",
          visible: true,
          sensitive: false,
          enabled: true,
          editable: false
        },
        {
          ref: "b2",
          frameId: 0,
          tag: "button",
          name: "Choose",
          rowContext: "Pro $29 per month Choose",
          visible: true,
          sensitive: false,
          enabled: true,
          editable: false
        }
      ]
    }
    const priceOf = (record: string | undefined, evidence: string) =>
      judgeAgentCompletion({
        steps: [],
        observation: plans,
        evidenceLedger: [fact(evidence, { requirementId: "r1" })],
        requirements: [
          {
            id: "r1",
            kind: "read",
            text: "Report the monthly price of the Pro plan",
            ...(record ? { check: { type: "row" as const, record } } : {})
          }
        ],
        outcomes: [{ id: "r1", met: true, evidence }]
      })

    it("verifies a quote from the row of the record the check names", () => {
      expect(priceOf("Pro", "$29 per month")).toEqual({
        type: "accepted",
        outcome: { met: ["r1"], unmet: [], graded: true }
      })
    })

    it("keeps an exact quote from the wrong row as the model's claim", () => {
      /** The wrong-row trap: grounded, exact, and the Basic plan's price. */
      expect(priceOf("Pro", "$9 per month")).toEqual({
        type: "accepted",
        outcome: { met: ["r1"], unmet: [], graded: true, claimed: ["r1"] }
      })
    })

    it("does not take a quote that only appears inside a longer one", () => {
      /** "$9 per month" sits inside nothing in the Pro row but "$29 per month". */
      expect(priceOf("Pro", "9 per month")).toMatchObject({
        outcome: { claimed: ["r1"] }
      })
    })

    it("keeps a quote no record ties to the question as a claim", () => {
      expect(priceOf(undefined, "$29 per month")).toMatchObject({
        outcome: { claimed: ["r1"] }
      })
    })
  })

  describe("a kept change is read back from a page loaded after it", () => {
    const saved = {
      id: "r1",
      kind: "change" as const,
      text: "Name holds Ada",
      persist: true as const,
      check: { type: "field" as const, name: "Name", value: "Ada" }
    }
    const step = (
      sequence: number,
      overrides: Partial<AgentStepReadout>
    ): AgentStepReadout => ({
      runId: "run-1",
      stepId: `run-1:${sequence}`,
      sequence,
      status: "verified",
      at: sequence,
      ...overrides
    })
    const typed = step(1, {
      command: {
        type: "clear_and_type",
        ref: "e1",
        snapshotId: "s1",
        generation: 1,
        text: "Ada"
      },
      requirementId: "r1",
      mutating: true,
      target: { ref: "e1", tag: "input", name: "Name" },
      verification: {
        outcome: "confirmed",
        evidence: { kind: "field", summary: "Field holds Ada", observedAt: 1 }
      }
    })
    const reopened = step(2, {
      command: {
        type: "navigate",
        url: "https://example.com/invoice/1",
        snapshotId: "s1",
        generation: 1
      },
      verification: {
        outcome: "confirmed",
        evidence: { kind: "navigation", summary: "Arrived", observedAt: 2 }
      }
    })
    const judgeSave = (steps: AgentStepReadout[]) =>
      judgeAgentCompletion({
        steps,
        observation: page,
        requirements: [saved],
        outcomes: [{ id: "r1", met: true }]
      })

    it("asks once for the record to be read back when only the edited page shows it", () => {
      /** The optimistic-save trap: the page holds Ada whether or not the server kept it. */
      expect(judgeSave([typed])).toMatchObject({
        type: "refused",
        reason: "readback_required"
      })
    })

    it("verifies it on a page the run loaded after the change", () => {
      expect(judgeSave([typed, reopened])).toEqual({
        type: "accepted",
        outcome: { met: ["r1"], unmet: [], graded: true }
      })
    })

    it("settles it as claimed when the run was asked and still did not read it back", () => {
      const asked = judgeSave([typed])
      const refusal = step(3, {
        stepId: "run-1:completion:3",
        status: "rejected",
        verification: {
          outcome: "negative",
          evidence: {
            kind: "completion",
            summary: asked.type === "refused" ? asked.feedback : "",
            observedAt: 3
          }
        }
      })
      expect(judgeSave([typed, refusal])).toEqual({
        type: "accepted",
        outcome: { met: ["r1"], unmet: [], graded: true, claimed: ["r1"] }
      })
    })

    it("never verifies a lost save because the run navigated after it", () => {
      /** The reopened record shows the old value: the receipt cannot vouch for it. */
      const lost: AgentObservation = {
        ...page,
        elements: page.elements.map((element) =>
          element.name === "Name" ? { ...element, value: "Bob" } : element
        )
      }
      expect(
        judgeAgentCompletion({
          steps: [typed, reopened],
          observation: lost,
          requirements: [saved],
          outcomes: [{ id: "r1", met: true }]
        })
      ).not.toMatchObject({ type: "accepted" })
      /** With no check, nothing can read the record back: claimed, not asked. */
      const { check: _check, ...checkless } = saved
      expect(
        judgeAgentCompletion({
          steps: [typed, reopened],
          observation: page,
          requirements: [{ ...checkless, text: "Name is saved as Ada" }],
          outcomes: [{ id: "r1", met: true }]
        })
      ).toEqual({
        type: "accepted",
        outcome: { met: ["r1"], unmet: [], claimed: ["r1"], graded: true }
      })
    })

    it("counts a submission the site accepted by moving on as the read back", () => {
      const submitted = step(2, {
        command: { type: "click", ref: "e5", snapshotId: "s1", generation: 1 },
        requirementId: "r1",
        mutating: true,
        consequential: ["submission"],
        verification: {
          outcome: "confirmed",
          evidence: {
            kind: "submission",
            summary: "Form committed its resolved destination",
            observedAt: 2,
            acceptance: "accepted"
          }
        }
      })
      expect(judgeSave([typed, submitted])).toMatchObject({ type: "accepted" })
    })
  })

  it("never counts a field the page marked invalid as holding its value", () => {
    const rejected: AgentObservation = {
      ...page,
      elements: page.elements.map((element) =>
        element.name === "Name" ? { ...element, invalid: true } : element
      )
    }
    expect(
      judge({ type: "field", name: "Name", value: "Ada" }, page, "")
    ).toMatchObject({ type: "accepted" })
    expect(
      judge({ type: "field", name: "Name", value: "Ada" }, rejected, "")
    ).not.toMatchObject({ type: "accepted" })
  })

  it("reads a custom switch, toggle button or tab as checked by its ARIA state", () => {
    const custom = (
      overrides: Partial<AgentObservation["elements"][number]>
    ): AgentObservation => ({
      ...page,
      elements: [
        {
          ref: "e9",
          frameId: 0,
          tag: "div",
          name: "Alerts",
          visible: true,
          sensitive: false,
          enabled: true,
          editable: false,
          ...overrides
        }
      ]
    })
    const on = { type: "checked", name: "Alerts", checked: true } as const
    for (const state of [
      { role: "switch", ariaChecked: true },
      { tag: "button", pressed: true },
      { role: "tab", selected: true }
    ])
      expect(judge(on, custom(state), "")).toMatchObject({ type: "accepted" })
    expect(
      judge(on, custom({ role: "switch", ariaChecked: false }), "")
    ).not.toMatchObject({ type: "accepted" })
    /** Mixed is neither on nor off. */
    expect(
      checkCompletionState(
        { id: "r1", kind: "change", text: "Alerts is checked", check: on },
        custom({ role: "checkbox", ariaChecked: "mixed" }),
        [],
        undefined
      )
    ).toBe(false)
  })

  it("reads a custom listbox's choice from the option its own listbox selected", () => {
    const combobox = (
      overrides: Partial<AgentObservation["elements"][number]>
    ): AgentObservation => ({
      ...page,
      elements: [
        {
          ref: "e9",
          frameId: 0,
          tag: "div",
          role: "combobox",
          name: "Colour",
          visible: true,
          sensitive: false,
          enabled: true,
          editable: false,
          ...overrides
        },
        /** Another dropdown's choice in the same frame answers nothing here. */
        {
          ref: "e10",
          frameId: 0,
          tag: "div",
          role: "option",
          name: "Blue",
          selected: true,
          visible: true,
          sensitive: false,
          enabled: true,
          editable: false
        }
      ]
    })
    const requirement = {
      id: "r1",
      kind: "change" as const,
      text: "Colour holds Blue",
      check: { type: "selected", name: "Colour", value: "Blue" } as const
    }
    const holds = (observation: AgentObservation) =>
      checkCompletionState(requirement, observation, [], undefined)
    expect(holds(combobox({ selectedOption: "Blue" }))).toBe(true)
    expect(holds(combobox({ selectedOption: "Red" }))).toBe(false)
    expect(holds(combobox({}))).toBe(false)
    /** Typed into the combobox, picked from nothing: not a selection. */
    expect(holds(combobox({ value: "Blue" }))).toBe(false)
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
  it("sends a status in other words to review, and one saying it failed back", () => {
    const check = {
      type: "record_state",
      record: "Invoice 1",
      state: "saved"
    } as const
    const status = (name: string) => ({
      ...page,
      visibleText: name,
      elements: page.elements.map((element) =>
        element.role === "status" ? { ...element, name } : element
      )
    })
    const said = (name: string) =>
      judge(check, status(name), name, [fact(name)])
    expect(said("Changes to Invoice 1 were stored")).toMatchObject({
      type: "refused",
      reason: "needs_review"
    })
    expect(said("Invoice 1 could not be saved")).toMatchObject({
      type: "refused",
      reason: "contradicted_state"
    })
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

  it.each([
    ["Turn on email notifications", true, true],
    ["Enable email notifications", true, true],
    ["Switch off email notifications", false, false],
    ["Disable email notifications", false, false]
  ])("verifies %s by the switch's own state", (text, wanted, state) => {
    const judged = judgeAgentCompletion({
      steps: [],
      observation: {
        ...page,
        elements: [
          {
            ref: "e9",
            frameId: 0,
            tag: "div",
            role: "switch",
            name: "Email notifications",
            ariaChecked: state,
            visible: true,
            sensitive: false,
            enabled: true,
            editable: false
          }
        ]
      },
      evidenceLedger: [],
      requirements: [
        {
          id: "r1",
          kind: "change",
          text,
          check: {
            type: "checked",
            name: "Email notifications",
            checked: wanted
          }
        }
      ],
      outcomes: [{ id: "r1", met: true, evidence: "Email notifications" }]
    })
    expect(judged.type).toBe("accepted")
    if (judged.type === "accepted")
      expect(judged.outcome?.claimed ?? []).not.toContain("r1")
  })

  it("reads a check whose name the planner shortened, unless it is ambiguous", () => {
    const box = (name: string, ref: string) => ({
      ref,
      frameId: 0,
      tag: "input",
      type: "checkbox",
      name,
      checked: true,
      visible: true,
      sensitive: false,
      enabled: true,
      editable: false
    })
    const judge = (elements: AgentObservation["elements"]) =>
      judgeAgentCompletion({
        steps: [],
        observation: { ...page, elements },
        evidenceLedger: [],
        requirements: [
          {
            id: "r1",
            kind: "change",
            text: "Accept the terms",
            check: { type: "checked", name: "terms", checked: true }
          }
        ],
        outcomes: [{ id: "r1", met: true, evidence: "I accept the terms" }]
      })
    expect(judge([box("I accept the terms", "e1")])).toMatchObject({
      type: "accepted"
    })
    expect(
      judge([box("I accept the terms", "e1"), box("Email me the terms", "e2")])
    ).toMatchObject({ type: "refused" })
  })

  /**
   * Measured live: "complete the application for Record 4" planned its
   * fields with the record named, and a record-scoped check was never read,
   * though the page was the record's own form and its fields sat in no row.
   */
  it("reads a record's field on the record's own page, never in a row", () => {
    const judge = (rowContext?: string) =>
      judgeAgentCompletion({
        steps: [
          {
            runId: "r",
            stepId: "s1",
            sequence: 1,
            status: "verified",
            at: 1,
            mutating: true,
            requirementId: "r1",
            target: { ref: "e1", tag: "input", name: "Name" },
            verification: {
              outcome: "confirmed",
              evidence: { kind: "field", summary: "field", observedAt: 1 }
            },
            heldPlannedValue: true
          }
        ],
        observation: {
          ...page,
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
              editable: true,
              ...(rowContext ? { rowContext } : {})
            }
          ]
        },
        requirements: [
          {
            id: "r1",
            kind: "change",
            text: "Set the Name to Ada for Invoice 1",
            check: {
              type: "field",
              name: "Name",
              value: "Ada",
              record: "Invoice 1"
            }
          }
        ],
        outcomes: [{ id: "r1", met: true }]
      })
    expect(judge()).toMatchObject({ type: "accepted" })
    expect(judge("Invoice 1 Name Ada")).toMatchObject({
      type: "refused",
      reason: "needs_review"
    })
  })

  describe("checks that outlive the page they were made on", () => {
    const confirmed = (kind: string) => ({
      outcome: "confirmed" as const,
      evidence: {
        kind,
        summary: kind,
        observedAt: 1,
        ...(kind === "submission" ? { acceptance: "accepted" as const } : {})
      }
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
    /**
     * Measured live: saving an embedded widget navigated only its frame, so
     * the run's address never changed while the fields it set were gone.
     */
    it("credits a field a confirmed save took off the page", () => {
      const saved = submit({
        consequential: ["save"],
        verification: {
          outcome: "confirmed",
          evidence: {
            kind: "activation",
            summary: "Control activation produced an observable page change",
            observedAt: 2
          }
        }
      })
      expect(judgeLeft([write(), saved])).toMatchObject({ type: "accepted" })
      expect(
        judgeLeft([write({ heldPlannedValue: undefined }), saved])
      ).toMatchObject({ type: "refused", reason: "contradicted_state" })
    })
    /**
     * Measured live: one fill set Name, Color and Agree for three
     * requirements under the first one's id, then Save left the form.
     * The two it was not filed under were refused as contradicted.
     */
    it("credits a batch write to every requirement it recorded holding", () => {
      expect(
        judgeLeft([
          write({
            requirementId: "r0",
            heldPlannedValue: undefined,
            heldPlannedFor: ["r1"]
          }),
          submit()
        ])
      ).toMatchObject({ type: "accepted" })
      expect(
        judgeLeft([
          write({
            requirementId: "r0",
            heldPlannedValue: undefined,
            heldPlannedFor: ["r3"]
          }),
          submit()
        ])
      ).toMatchObject({ type: "refused", reason: "contradicted_state" })
    })
    /**
     * Measured live: "accept the terms and continue" ticked the box, pressed
     * Continue, and every completion was refused as contradicted, because
     * the box was not on the page Continue opened.
     */
    describe("a box the run ticked and then left behind", () => {
      const terms = {
        id: "r1",
        kind: "change" as const,
        text: "Accept the terms",
        check: { type: "checked" as const, name: "terms", checked: true }
      }
      const ticked = (overrides: Partial<AgentStepReadout> = {}) =>
        write({
          target: { ref: "e1", tag: "input", name: "terms" },
          verification: confirmed("checked"),
          ...overrides
        })
      const judgeTerms = (steps: AgentStepReadout[], elements = []) =>
        judgeAgentCompletion({
          steps,
          observation: { ...leftPage, elements },
          evidenceLedger: [],
          requirements: [terms],
          outcomes: [{ id: "r1", met: true }]
        })

      it("records a held state only for the planned state, confirmed", () => {
        expect(
          agentWriteHeldPlannedValue(
            terms,
            [{ accessibleName: "terms", expectedChecked: true }],
            confirmed("checked")
          )
        ).toBe(true)
        expect(
          agentWriteHeldPlannedValue(
            terms,
            [{ accessibleName: "terms", expectedChecked: false }],
            confirmed("checked")
          )
        ).toBe(false)
        expect(
          agentWriteHeldPlannedValue(
            terms,
            [{ accessibleName: "terms", expectedChecked: true }],
            confirmed("activation")
          )
        ).toBe(false)
      })

      it("credits the box once the page that held it is gone", () => {
        expect(judgeTerms([ticked(), submit()])).toMatchObject({
          type: "accepted"
        })
      })

      it("credits the box when Continue's own receipt never said it left", () => {
        /** The click posted, changed the page, then navigated. */
        const formUrl = "https://example.com/application"
        const clicked = submit({
          consequential: [],
          sourceUrl: formUrl,
          verification: {
            outcome: "confirmed",
            evidence: {
              kind: "activation",
              summary: "Control activation produced an observable page change",
              observedAt: 2
            }
          }
        })
        expect(
          judgeTerms([ticked({ sourceUrl: formUrl }), clicked])
        ).toMatchObject({ type: "accepted" })
        /** Still on the form: the click left it in place. */
        expect(
          judgeAgentCompletion({
            steps: [ticked({ sourceUrl: formUrl }), clicked],
            observation: { ...leftPage, url: formUrl, elements: [] },
            evidenceLedger: [],
            requirements: [terms],
            outcomes: [{ id: "r1", met: true }]
          })
        ).toMatchObject({ type: "refused" })
      })

      it("decides by the box it left before a phrase match on the new page", () => {
        const other = (checked: boolean) => ({
          ref: "e9",
          frameId: 0,
          tag: "input",
          type: "checkbox",
          name: "Email me the terms",
          checked,
          visible: true,
          sensitive: false,
          enabled: true,
          editable: false
        })
        expect(
          judgeTerms([ticked(), submit()], [other(false)] as never)
        ).toMatchObject({ type: "accepted" })
        expect(
          judgeTerms([ticked({ heldPlannedValue: undefined }), submit()], [
            other(true)
          ] as never)
        ).toMatchObject({ type: "refused" })
      })

      it("reads a reopened form's box rather than the earlier write", () => {
        const formUrl = "https://example.com/application"
        const reopened = (checked: boolean) =>
          judgeAgentCompletion({
            steps: [ticked({ sourceUrl: formUrl }), submit()],
            observation: {
              ...leftPage,
              url: formUrl,
              elements: [
                {
                  ref: "e1",
                  frameId: 0,
                  tag: "input",
                  type: "checkbox",
                  name: "I accept the terms",
                  checked,
                  visible: true,
                  sensitive: false,
                  enabled: true,
                  editable: false
                }
              ]
            },
            evidenceLedger: [],
            requirements: [terms],
            outcomes: [{ id: "r1", met: true }]
          })
        expect(reopened(false)).toMatchObject({ type: "refused" })
        expect(reopened(true)).toMatchObject({ type: "accepted" })
      })

      it("credits nothing for a box never recorded as holding its state", () => {
        expect(
          judgeTerms([ticked({ heldPlannedValue: undefined }), submit()])
        ).toMatchObject({ type: "refused", reason: "contradicted_state" })
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
    it("credits a field the run filled and then left by a followed link", () => {
      const followed = submit({
        consequential: [],
        verification: {
          outcome: "confirmed",
          evidence: {
            kind: "activation",
            summary: "Authorized destination is committed",
            observedAt: 2
          }
        }
      })
      expect(judgeLeft([write(), followed])).toMatchObject({
        type: "accepted"
      })
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
      target: { ref: "e1", tag: "input", name: "First" },
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
    it("credits an instruction to press when the presses match it", () => {
      expect(
        constraintReviewed(
          judgeKeys("Press Tab to move to Second.", [pressed("Tab")])
        )
      ).toBe(false)
      /** A method allows any number of presses. */
      expect(
        constraintReviewed(
          judgeKeys("Move focus using Tab.", [
            pressed("Tab"),
            pressed("Tab", { stepId: "press-2", sequence: 2 })
          ])
        )
      ).toBe(false)
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
      ["the limit counts presses", "Press Tab at most once.", [pressed("Tab")]],
      [
        "the limit adds a condition",
        "Use Tab only after saving the form.",
        [pressed("Tab")]
      ],
      [
        "the limit names a different control",
        "Use Tab to reach Submit.",
        [pressed("Tab")]
      ],
      [
        "it asked for one press and the run pressed three",
        "Press Tab to move to Second.",
        [
          pressed("Tab"),
          pressed("Tab", { stepId: "press-2", sequence: 2 }),
          pressed("Tab", { stepId: "press-3", sequence: 3 })
        ]
      ]
    ] as const)("still reviews the constraint when %s", (_, text, steps) => {
      expect(constraintReviewed(judgeKeys(text, [...steps]))).toBe(true)
    })
    it("settles a stop on the focus move its quotation credited", () => {
      const judgement = judgeAgentCompletion({
        steps: [pressed("Tab")],
        observation: focused,
        evidenceLedger: [],
        constraints: [
          {
            id: "c1",
            text: "Stop once Second has keyboard focus",
            kind: "limit"
          }
        ],
        requirements: [
          { id: "r1", kind: "change", text: "Second has keyboard focus" }
        ],
        outcomes: [{ id: "r1", met: true, evidence: "Second" }]
      })
      expect(constraintReviewed(judgement)).toBe(false)
      expect(judgement).toMatchObject({ type: "accepted" })
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
    const submitted = (stepId: string, sequence: number) =>
      selected({
        stepId,
        sequence,
        target: { ref: "e5", tag: "button", name: "Submit" },
        verification: {
          outcome: "confirmed",
          evidence: {
            kind: "submission",
            summary: "submitted",
            observedAt: 1,
            acceptance: "accepted"
          }
        }
      })
    const filled = selected({
      stepId: "fill",
      target: { ref: "e6", tag: "input", name: "Email" }
    })
    const judgeSubmitStop = (steps: AgentStepReadout[]) =>
      judgeAgentCompletion({
        steps,
        observation: page,
        evidenceLedger: [],
        constraints: [
          { id: "c1", text: "Stop once the form is submitted.", kind: "limit" }
        ],
        requirements: [
          { id: "r1", kind: "change", text: "The form is submitted." }
        ],
        outcomes: [{ id: "r1", met: true }]
      })
    it("settles a stop on a submit after the fills that prepared it", () => {
      expect(
        judgeSubmitStop([filled, submitted("submit", 2)])
      ).not.toMatchObject({ type: "refused", reason: "needs_review" })
    })
    it("settles a stop on a search submitted after filling its field", () => {
      expect(
        judgeAgentCompletion({
          steps: [
            selected({
              stepId: "fill",
              target: { ref: "e6", tag: "input", name: "Search" }
            }),
            selected({
              stepId: "submit",
              sequence: 2,
              target: { ref: "e7", tag: "button", name: "Go" },
              verification: {
                outcome: "confirmed",
                evidence: {
                  kind: "submission",
                  summary: "submitted",
                  observedAt: 2,
                  acceptance: "accepted",
                  values: [{ name: "Search", value: "Alice" }]
                }
              }
            })
          ],
          observation: page,
          evidenceLedger: [],
          constraints: [
            { id: "c1", text: "Stop once Search for Alice.", kind: "limit" }
          ],
          requirements: [
            { id: "r1", kind: "change", text: "Search for Alice." }
          ],
          outcomes: [{ id: "r1", met: true }]
        })
      ).not.toMatchObject({ type: "refused", reason: "needs_review" })
    })
    it("leaves it to review when the form was submitted twice", () => {
      expect(
        judgeSubmitStop([submitted("submit", 1), submitted("again", 2)])
      ).toMatchObject({ type: "refused", reason: "needs_review" })
    })
    it.each(["Blue is selected from Color.", "Color shows Blue."])(
      "leaves it to review when a Save followed a select for %s",
      (outcome) => {
        expect(
          judgeAgentCompletion({
            steps: [
              selected({
                command: {
                  type: "select",
                  ref: "e3",
                  snapshotId: "s1",
                  generation: 1,
                  value: "Blue"
                }
              }),
              selected({
                stepId: "save",
                sequence: 2,
                target: { ref: "e4", tag: "button", name: "Save" },
                verification: {
                  outcome: "confirmed",
                  evidence: {
                    kind: "activation",
                    summary: "saved",
                    observedAt: 2
                  }
                }
              })
            ],
            observation: page,
            evidenceLedger: [],
            constraints: [
              {
                id: "c1",
                text: `Stop once ${outcome.replace(/\.$/, "")}`,
                kind: "limit"
              }
            ],
            requirements: [{ id: "r1", kind: "change", text: outcome }],
            outcomes: [{ id: "r1", met: true }]
          })
        ).toMatchObject({ type: "refused", reason: "needs_review" })
      }
    )
    it("leaves it to review when a Save followed an unchecked select", () => {
      expect(
        judgeAgentCompletion({
          steps: [
            selected(),
            selected({
              stepId: "save",
              sequence: 2,
              target: { ref: "e4", tag: "button", name: "Save" },
              verification: {
                outcome: "confirmed",
                evidence: {
                  kind: "activation",
                  summary: "saved",
                  observedAt: 2
                }
              }
            })
          ],
          observation: page,
          evidenceLedger: [],
          constraints: [
            { id: "c1", text: "Stop once Blue is selected.", kind: "limit" }
          ],
          requirements: [
            { id: "r1", kind: "change", text: "Blue is selected from Color." }
          ],
          outcomes: [{ id: "r1", met: true }]
        })
      ).toMatchObject({ type: "refused", reason: "needs_review" })
    })
    it("settles a stop on a submission that is itself the outcome", () => {
      expect(
        judgeAgentCompletion({
          steps: [
            selected({
              target: { ref: "e5", tag: "button", name: "Submit" },
              verification: {
                outcome: "confirmed",
                evidence: {
                  kind: "submission",
                  summary: "submitted",
                  observedAt: 1,
                  acceptance: "accepted"
                }
              }
            })
          ],
          observation: page,
          evidenceLedger: [],
          constraints: [
            {
              id: "c1",
              text: "Stop once the form is submitted.",
              kind: "limit"
            }
          ],
          requirements: [
            { id: "r1", kind: "change", text: "The form is submitted." }
          ],
          outcomes: [{ id: "r1", met: true }]
        })
      ).not.toMatchObject({ type: "refused", reason: "needs_review" })
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
      [
        "a later Save for the same outcome acted after it held",
        "Stop once Blue is selected.",
        [
          selected(),
          selected({
            stepId: "save",
            sequence: 2,
            target: { ref: "e4", tag: "button", name: "Save" },
            verification: {
              outcome: "confirmed",
              evidence: { kind: "activation", summary: "saved", observedAt: 2 }
            }
          })
        ]
      ],
      ["it names something else", "Stop once Red is selected.", [selected()]],
      ["it is not a stop condition", "Only select Blue.", [selected()]],
      ["this run changed nothing", "Stop once Blue is selected.", []],
      [
        "its last change was not confirmed",
        "Stop once Blue is selected.",
        [
          selected({
            verification: {
              outcome: "ambiguous",
              evidence: { kind: "field", summary: "?", observedAt: 1 }
            }
          })
        ]
      ]
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
    it("spends one opened tab on one opening requirement", () => {
      const judgeTwo = (steps: AgentStepReadout[]) =>
        judgeAgentCompletion({
          steps,
          observation: onDetails,
          evidenceLedger: [],
          requirements: [
            { id: "r1", kind: "change", text: "Details is open in a new tab." },
            {
              id: "r2",
              kind: "change",
              text: "Details is open in a second tab."
            }
          ],
          outcomes: [
            { id: "r1", met: true, evidence: "Status: Active" },
            { id: "r2", met: true, evidence: "Status: Active" }
          ]
        })
      expect(judgeTwo([opened({ requirementId: undefined })]).type).not.toBe(
        "accepted"
      )
      expect(
        judgeTwo([
          opened({ requirementId: undefined }),
          opened({ stepId: "open2", sequence: 2, requirementId: undefined })
        ])
      ).toMatchObject({ type: "accepted" })
    })
  })
})

describe("renamed-control receipt binding", () => {
  const requirement = {
    id: "r1",
    kind: "change" as const,
    text: "Close becomes Reopen",
    check: { type: "control_transition" as const, from: "Close", to: "Reopen" }
  }
  const after = {
    ...page,
    elements: [
      {
        ...page.elements[0],
        tag: "button",
        name: "Reopen",
        verificationId: "same-button"
      }
    ]
  }
  const receipt: AgentStepReadout = {
    runId: "r",
    stepId: "s",
    sequence: 1,
    status: "verified",
    at: 1,
    requirementId: "r1",
    verification: {
      outcome: "confirmed",
      evidence: {
        kind: "activation",
        summary: "changed",
        observedAt: 1,
        controlTransition: {
          from: "Close",
          to: "Reopen",
          frameId: 0,
          documentId: "d1",
          verificationId: "same-button"
        }
      }
    }
  }
  it("requires a receipt from the same requirement, frame, document and control", () => {
    expect(
      checkCompletionState(requirement, after, [], undefined, [receipt])
    ).toBe(true)
    expect(checkCompletionState(requirement, after, [], undefined, [])).toBe(
      false
    )
    expect(
      checkCompletionState(requirement, after, [], undefined, [
        { ...receipt, requirementId: "r2" }
      ])
    ).toBe(false)
    expect(
      checkCompletionState(
        requirement,
        { ...after, documentId: "other" },
        [],
        undefined,
        [receipt]
      )
    ).toBe(false)
    expect(
      checkCompletionState(
        requirement,
        {
          ...after,
          elements: [{ ...after.elements[0], verificationId: "other-button" }]
        },
        [],
        undefined,
        [receipt]
      )
    ).toBe(false)
  })

  it("proves a record only by its exact row, and leaves a near-name to review", () => {
    const scoped = {
      ...requirement,
      text: "Record 1: Close becomes Reopen",
      check: { ...requirement.check, record: "Record 1" }
    }
    const inRow = (row: string) => ({
      observation: {
        ...after,
        elements: [{ ...after.elements[0], rowContext: `${row} Reopen` }]
      },
      clicked: {
        ...receipt,
        target: {
          ref: "e1",
          tag: "button",
          name: "Close",
          rowContext: `${row} Close`
        }
      }
    })
    const exact = inRow("Record 1")
    expect(
      checkCompletionState(scoped, exact.observation, [], undefined, [
        exact.clicked
      ])
    ).toBe(true)
    const copy = inRow("Record 1 copy")
    expect(
      checkCompletionState(scoped, copy.observation, [], undefined, [
        copy.clicked
      ])
    ).toBeUndefined()
    expect(
      checkCompletionState(scoped, exact.observation, [], undefined, [
        copy.clicked
      ])
    ).toBeUndefined()
  })

  it("accepts the transition only in the direction the requirement states", () => {
    const clicked: AgentStepReadout = {
      ...receipt,
      command: { type: "click", ref: "e1", snapshotId: "s1", generation: 1 },
      target: { ref: "e1", tag: "button", name: "Close" }
    }
    const judge = (text: string) =>
      judgeAgentCompletion({
        steps: [clicked],
        observation: after,
        requirements: [{ ...requirement, text }],
        outcomes: [{ id: "r1", met: true }]
      }).type
    expect(judge("Close changes to Reopen")).toBe("accepted")
    expect(judge("Reopen changes to Close")).not.toBe("accepted")
    expect(judge("Reopen replaces Close")).not.toBe("accepted")
  })
})

it("labels the items of a claimed requirement as claimed, not verified", () => {
  const result = agentRunResult(
    "Done",
    [
      {
        id: "r1",
        kind: "change",
        text: "Invoices are saved",
        persist: true,
        items: ["Invoice 1", "Invoice 2"]
      }
    ],
    [
      {
        id: "r1",
        met: true,
        items: [
          { index: 0, met: true },
          { index: 1, met: true }
        ]
      }
    ],
    ["r1"],
    {
      met: ["r1"],
      unmet: [],
      claimed: ["r1"],
      graded: true,
      items: [{ id: "r1", met: [0, 1] }]
    }
  )
  expect(result).toContain("Reported, not checked item: Invoice 1")
  expect(result).not.toContain("Verified")
})

describe("state requirements in other languages", () => {
  const judge = (text: string, name: string, wanted: boolean, state: boolean) =>
    judgeAgentCompletion({
      steps: [],
      observation: {
        ...page,
        elements: [
          {
            ref: "e9",
            frameId: 0,
            tag: "input",
            type: "checkbox",
            name,
            checked: state,
            visible: true,
            sensitive: false,
            enabled: true,
            editable: false
          }
        ]
      },
      evidenceLedger: [],
      requirements: [
        {
          id: "r1",
          kind: "change",
          text,
          check: { type: "checked", name, checked: wanted }
        }
      ],
      outcomes: [{ id: "r1", met: true, evidence: name }]
    })
  const verified = (judged: ReturnType<typeof judge>) =>
    judged.type === "accepted" &&
    !(judged.outcome?.claimed ?? []).includes("r1")

  it.each([
    ["Das Kästchen Newsletter ist angehakt", true],
    ["La casilla Newsletter está marcada", true],
    ["La case Newsletter est cochée", true],
    ["La casella Newsletter è spuntata", true],
    ["Флажок Newsletter отмечен", true],
    ["Newsletter चेकबॉक्स चुना गया है", true],
    ["Newsletter ist deaktiviert", false],
    ["La case Newsletter est décochée", false],
    ["Флажок Newsletter снят", false],
    ["La casella Newsletter è deselezionata", false]
  ])("verifies %s by the box's own state", (text, wanted) => {
    expect(verified(judge(text, "Newsletter", wanted, wanted))).toBe(true)
  })

  it("verifies terms accepted in another language", () => {
    expect(verified(judge("Die AGB akzeptieren", "AGB", true, true))).toBe(true)
    expect(verified(judge("Acepto los términos", "términos", true, true))).toBe(
      true
    )
  })

  it.each([
    ["Das Kästchen Newsletter ist nicht angehakt", true],
    ["Newsletter ist nicht deaktiviert", true],
    ["Newsletter ist nicht deaktiviert", false],
    ["La casilla Newsletter está marcada y enviada", true],
    ["Die AGB nicht akzeptieren", true],
    ["Newsletterにチェックが入っている", true],
    ["已勾选Newsletter", true]
  ])("does not verify %s", (text, wanted) => {
    expect(verified(judge(text, "Newsletter", wanted, wanted))).toBe(false)
  })
})
