import type {
  AgentObservation,
  AgentRunState,
  AgentTaskConstraint,
  AgentTaskRequirement
} from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import { judgeAgentCompletion } from "../completion"
import { agentLimitAnsweredByActions } from "../completion-review"
import {
  agentHeldLiteralStands,
  checkCompletionState
} from "../completion-support"
import type { AgentStepReadout } from "../ports"
import { buildAgentWorkflow } from "../workflow"

const EDITOR = "https://example.com/a1"
const RESULT = "https://example.com/a1/result"
const TEXT = "Draft for Record 1. Ready for review."

const page = (
  url: string,
  elements: AgentObservation["elements"]
): AgentObservation => ({
  snapshotId: "s2",
  generation: 2,
  tabId: 7,
  frameId: 0,
  documentId: "d2",
  url,
  origin: "https://example.com",
  title: "Record 1",
  visibleText: "Saved",
  elements,
  dialogs: [],
  capturedAt: 3,
  frames: [
    {
      frameId: 0,
      documentId: "d2",
      snapshotId: "s2",
      generation: 2,
      origin: "https://example.com",
      url,
      access: "ok"
    }
  ],
  scroll: {
    x: 0,
    y: 0,
    viewportWidth: 1,
    viewportHeight: 1,
    documentWidth: 1,
    documentHeight: 1
  }
})

const control = (
  ref: string,
  name: string,
  overrides: Partial<AgentObservation["elements"][number]> = {}
): AgentObservation["elements"][number] => ({
  ref,
  frameId: 0,
  tag: "button",
  name,
  visible: true,
  sensitive: false,
  enabled: true,
  editable: false,
  ...overrides
})

const editor = (value: string) =>
  control("e1", "Draft", { tag: "div", role: "textbox", value, editable: true })

const r1: AgentTaskRequirement = {
  id: "r1",
  kind: "change",
  text: "The editor contents are exactly the requested text.",
  check: { type: "field", name: "editor", value: TEXT }
}
const r2: AgentTaskRequirement = {
  id: "r2",
  kind: "change",
  text: "The draft is saved.",
  persist: true
}

const write = (
  overrides: Partial<AgentStepReadout> = {}
): AgentStepReadout => ({
  runId: "run",
  stepId: "run:1",
  sequence: 1,
  status: "verified",
  at: 1,
  mutating: true,
  consequential: [],
  requirementId: "r1",
  heldPlannedValue: true,
  command: {
    type: "clear_and_type",
    ref: "e1",
    text: TEXT,
    snapshotId: "s1",
    generation: 1
  },
  target: { ref: "e1", tag: "div", role: "textbox", name: "Draft" },
  sourceUrl: EDITOR,
  verification: {
    outcome: "confirmed",
    evidence: {
      kind: "field",
      summary: "Field contains the resolved value",
      observedAt: 1
    }
  },
  ...overrides
})

const click = (
  sequence: number,
  name: string,
  overrides: Partial<AgentStepReadout> = {}
): AgentStepReadout => ({
  runId: "run",
  stepId: `run:${sequence}`,
  sequence,
  status: "verified",
  at: sequence,
  mutating: true,
  consequential: ["save"],
  requirementId: "r2",
  command: { type: "click", ref: "e2", snapshotId: "s1", generation: 1 },
  target: { ref: "e2", tag: "button", name },
  sourceUrl: EDITOR,
  verification: {
    outcome: "confirmed",
    evidence: {
      kind: "activation",
      summary: "Control activation produced an observable page change",
      observedAt: sequence
    }
  },
  ...overrides
})

const state = {
  version: 1,
  id: "run",
  goal: "Replace the editor text, save once, do not publish",
  status: "observing",
  stepCount: 2,
  observationCount: 2,
  controlledTabId: 7,
  providerId: "p",
  modelId: "m",
  allowedOrigins: ["https://example.com"],
  createdAt: 1,
  updatedAt: 3,
  requirements: [r1, r2],
  constraints: []
} as unknown as AgentRunState

const status = (steps: AgentStepReadout[], observation: AgentObservation) =>
  buildAgentWorkflow(state, steps, observation)?.workflow.entries.find(
    (entry) => entry.requirementId === "r1"
  )?.status

describe("a checked write the run confirmed", () => {
  it("is verified while the control still holds it", () => {
    expect(status([write()], page(EDITOR, [editor(TEXT)]))).toBe("verified")
  })

  it("stays verified after a save navigated it off the page", () => {
    expect(status([write(), click(2, "Save draft")], page(RESULT, []))).toBe(
      "verified"
    )
  })

  it("is not verified when the run walked away by a link without saving", () => {
    const followed = click(2, "Other record", {
      consequential: [],
      requirementId: undefined,
      target: { ref: "e7", tag: "a", role: "link", name: "Other record" },
      verification: {
        outcome: "confirmed",
        evidence: {
          kind: "activation",
          summary: "Authorized destination is committed",
          observedAt: 2
        }
      }
    })
    const away = page("https://example.com/a2", [])
    expect(status([write(), followed], away)).not.toBe("verified")
    expect(
      checkCompletionState(r1, away, [], undefined, [write(), followed])
    ).toBe(false)
  })

  describe("credits only a commit the leaving step made or the form's page saw", () => {
    const OTHER = "https://example.com/a2"
    const link = (sequence: number, sourceUrl = EDITOR) =>
      click(sequence, "Other record", {
        consequential: [],
        requirementId: undefined,
        sourceUrl,
        target: { ref: "e7", tag: "a", role: "link", name: "Other record" },
        verification: {
          outcome: "confirmed",
          evidence: {
            kind: "activation",
            summary: "Authorized destination is committed",
            observedAt: sequence
          }
        }
      })
    const press = (sequence: number, name: string, sourceUrl = EDITOR) =>
      click(sequence, name, {
        consequential: [],
        requirementId: undefined,
        sourceUrl
      })
    const read = (steps: AgentStepReadout[], url = OTHER) =>
      checkCompletionState(r1, page(url, []), [], undefined, steps)

    it("refuses an in-page Preview followed by a link away", () => {
      const steps = [write(), press(2, "Preview"), link(3)]
      expect(read(steps)).toBe(false)
      expect(status(steps, page(OTHER, []))).not.toBe("verified")
    })

    it("refuses a press on the page a link opened", () => {
      expect(read([write(), link(2), press(3, "Accept cookies", OTHER)])).toBe(
        false
      )
    })

    it("refuses a change already on another page", () => {
      expect(read([write(), press(2, "Accept cookies", OTHER)])).toBe(false)
    })

    it("credits a save on the form's page before a link away", () => {
      expect(read([write(), click(2, "Save draft"), link(3)])).toBe(true)
    })

    it("credits a non-link press whose activation left the page", () => {
      expect(read([write(), press(2, "Continue")])).toBe(true)
    })

    it("never counts a submission the site turned away as a commit", () => {
      const submit = (
        sequence: number,
        acceptance: "accepted" | "dispatched" | "rejected"
      ) =>
        click(sequence, "Submit", {
          consequential: ["submission"],
          requirementId: undefined,
          verification: {
            outcome: "confirmed",
            evidence: {
              kind: "submission",
              summary: "Form committed its resolved destination",
              observedAt: sequence,
              acceptance
            }
          }
        })
      expect(read([write(), submit(2, "rejected")])).toBe(false)
      expect(read([write(), submit(2, "rejected"), link(3)])).toBe(false)
      expect(read([write(), submit(2, "accepted")])).toBe(true)
      /** A submission with no class behind it carries the form only once the site took it. */
      const unclassed = (acceptance: "accepted" | "dispatched") => ({
        ...submit(2, acceptance),
        consequential: []
      })
      expect(read([write(), unclassed("dispatched"), link(3)])).toBe(false)
      expect(read([write(), unclassed("accepted"), link(3)])).toBe(true)
      const quoted: AgentTaskRequirement = {
        id: "r1",
        kind: "change",
        text: `The Draft holds exactly "${TEXT}"`
      }
      const judge = (steps: AgentStepReadout[]) =>
        agentHeldLiteralStands(quoted, steps, page(OTHER, []))
      expect(judge([write(), submit(2, "rejected")])).toBe(false)
      expect(judge([write(), submit(2, "rejected"), link(3)])).toBe(false)
      expect(judge([write(), submit(2, "accepted")])).toBe(true)
    })

    it("refuses a quoted literal walked away from by a link", () => {
      const quoted: AgentTaskRequirement = {
        id: "r1",
        kind: "change",
        text: `The Draft holds exactly "${TEXT}"`
      }
      const judge = (steps: AgentStepReadout[]) =>
        agentHeldLiteralStands(quoted, steps, page(OTHER, []))
      expect(judge([write(), link(2)])).toBe(false)
      expect(judge([write(), press(2, "Preview"), link(3)])).toBe(false)
      expect(judge([write(), click(2, "Save draft")])).toBe(true)
    })
  })

  it("is not verified once the control is back holding something else", () => {
    expect(
      status([write(), click(2, "Save draft")], page(EDITOR, [editor("")]))
    ).toBe("effect_confirmed")
  })

  it("is not verified when the write never held the check's value", () => {
    expect(
      status(
        [write({ heldPlannedValue: undefined }), click(2, "Save draft")],
        page(RESULT, [])
      )
    ).toBe("effect_confirmed")
  })
})

describe("the judge reading a checked write under the page's label", () => {
  const saved = [write(), click(2, "Save draft")]
  const read = (observation: AgentObservation) =>
    checkCompletionState(r1, observation, [], undefined, saved)

  it("refuses an editor the run went back to and found empty", () => {
    expect(read(page(EDITOR, [editor("")]))).toBe(false)
  })

  it("credits an editor a navigating save took off the page", () => {
    expect(read(page(RESULT, []))).toBe(true)
  })

  it("credits an editor still holding the value", () => {
    expect(read(page(EDITOR, [editor(TEXT)]))).toBe(true)
  })
})

describe("an exclusion of an act a control carries", () => {
  const noPublish: AgentTaskConstraint = {
    id: "c1",
    kind: "exclude",
    text: "Do not publish."
  }
  const held: AgentTaskRequirement = {
    id: "r1",
    kind: "change",
    text: `Draft holds ${TEXT}`,
    check: { type: "field", name: "Draft", value: TEXT }
  }
  const judge = (steps: AgentStepReadout[], elements = [editor(TEXT)]) =>
    judgeAgentCompletion({
      steps,
      observation: page(EDITOR, elements),
      evidenceLedger: [],
      requirements: [held],
      constraints: [noPublish],
      outcomes: [{ id: "r1", met: true }]
    })

  it("is answered by the run's actions, not a page quote", () => {
    expect(agentLimitAnsweredByActions(noPublish)).toBe(true)
  })

  it("holds when the page offers Publish and the run never pressed it", () => {
    expect(
      judge(
        [write(), click(2, "Save draft")],
        [editor(TEXT), control("e3", "Publish")]
      )
    ).toMatchObject({ type: "accepted" })
  })

  it("is contradicted by a press of Publish", () => {
    expect(
      judge(
        [write(), click(2, "Publish", { consequential: [] })],
        [editor(TEXT), control("e3", "Publish")]
      )
    ).toMatchObject({ type: "refused", reason: "contradicted_state" })
  })

  it("sends a press of the declining choice to review, not to violation", () => {
    for (const name of ["Don't publish", "Do not publish"])
      expect(
        judge(
          [write(), click(2, name, { consequential: [] })],
          [editor(TEXT), control("e3", "Publish"), control("e4", name)]
        )
      ).toMatchObject({ type: "refused", reason: "needs_review" })
  })

  const set = (
    sequence: number,
    command: AgentStepReadout["command"],
    name: string
  ) =>
    click(sequence, name, {
      requirementId: "r1",
      consequential: [],
      command,
      target: { ref: "e4", tag: "input", name },
      verification: {
        outcome: "confirmed",
        evidence: {
          kind: "form_mutation",
          summary: "Control state changed",
          observedAt: sequence
        }
      }
    })
  const offered = [editor(TEXT), control("e3", "Publish")]

  it("is contradicted by a control set to the act rather than pressed", () => {
    for (const steps of [
      [
        write(),
        set(
          2,
          { type: "check", ref: "e4", snapshotId: "s1", generation: 1 },
          "Publish to web"
        )
      ],
      [
        write(),
        set(
          2,
          {
            type: "select",
            ref: "e4",
            value: "Published",
            snapshotId: "s1",
            generation: 1
          },
          "Status"
        )
      ],
      [
        write(),
        set(
          2,
          {
            type: "fill_form",
            fields: [{ type: "select", ref: "e4", value: "Published" }],
            snapshotId: "s1",
            generation: 1
          },
          "Status"
        )
      ]
    ])
      expect(judge(steps, offered)).toMatchObject({
        type: "refused",
        reason: "contradicted_state"
      })
  })

  it("is contradicted by a batched box named for the act, as a single check is", () => {
    const batch = () =>
      set(
        2,
        {
          type: "fill_form",
          fields: [
            { type: "clear_and_type", ref: "e1", text: TEXT },
            { type: "check", ref: "e4" }
          ],
          snapshotId: "s1",
          generation: 1
        },
        "Draft"
      )
    const named = (name: string) => ({
      ...batch(),
      verification: {
        outcome: "confirmed" as const,
        evidence: {
          kind: "fields" as const,
          summary: "All 2 fields hold the resolved value",
          observedAt: 2,
          fields: [{ name: "Draft" }, { name }]
        }
      }
    })
    expect(judge([write(), named("Publish to web")], offered)).toMatchObject({
      type: "refused",
      reason: "contradicted_state"
    })
    expect(
      judge(
        [
          write(),
          set(
            2,
            { type: "check", ref: "e4", snapshotId: "s1", generation: 1 },
            "Publish to web"
          )
        ],
        offered
      )
    ).toMatchObject({ type: "refused", reason: "contradicted_state" })
    expect(judge([write(), named("Don't publish")], offered)).toMatchObject({
      type: "refused",
      reason: "needs_review"
    })
  })

  it("goes to review when the control was set to the act's negation", () => {
    const select = (value: string) =>
      set(
        2,
        { type: "select", ref: "e4", value, snapshotId: "s1", generation: 1 },
        "Status"
      )
    for (const steps of [
      [write(), select("Not published")],
      [write(), select("Don't publish")],
      [write(), select("Unpublished")],
      [
        write(),
        set(
          2,
          { type: "check", ref: "e4", snapshotId: "s1", generation: 1 },
          "Do not publish to web"
        )
      ],
      [
        write(),
        set(
          2,
          {
            type: "fill_form",
            fields: [{ type: "select", ref: "e4", value: "Never publish" }],
            snapshotId: "s1",
            generation: 1
          },
          "Status"
        )
      ]
    ])
      expect(judge(steps, offered)).toMatchObject({
        type: "refused",
        reason: "needs_review"
      })
  })

  it("goes to review when a change could have carried the act unnamed", () => {
    for (const steps of [
      [
        write(),
        set(
          2,
          { type: "check", ref: "e4", snapshotId: "s1", generation: 1 },
          "Make public"
        )
      ],
      [
        write(),
        set(
          2,
          {
            type: "drag",
            ref: "e4",
            to: "e5",
            snapshotId: "s1",
            generation: 1
          },
          "Card 1"
        )
      ],
      [
        write(),
        set(
          2,
          {
            type: "clear_and_type",
            ref: "e4",
            text: "Published",
            snapshotId: "s1",
            generation: 1
          },
          "Status"
        )
      ],
      [
        write(),
        click(2, "", {
          consequential: [],
          command: {
            type: "click_point",
            x: 4,
            y: 4,
            snapshotId: "s1",
            generation: 1
          },
          target: undefined
        })
      ]
    ])
      expect(judge(steps, offered)).toMatchObject({
        type: "refused",
        reason: "needs_review"
      })
  })

  it("is contradicted by a pointer press on Publish", () => {
    expect(
      judge(
        [
          write(),
          click(2, "Publish", {
            consequential: [],
            command: {
              type: "click_point",
              x: 4,
              y: 4,
              snapshotId: "s1",
              generation: 1
            }
          })
        ],
        offered
      )
    ).toMatchObject({ type: "refused", reason: "contradicted_state" })
  })

  it("goes to review when no Publish control is in view", () => {
    expect(judge([write(), click(2, "Save draft")])).toMatchObject({
      type: "refused",
      reason: "needs_review"
    })
  })

  it("goes to review when the run sent a form that could have carried it", () => {
    expect(
      judge(
        [write(), click(2, "Save draft", { consequential: ["submission"] })],
        [editor(TEXT), control("e3", "Publish")]
      )
    ).toMatchObject({ type: "refused", reason: "needs_review" })
  })
})

describe("a kept change whose check does not hold", () => {
  const rename: AgentTaskRequirement = {
    id: "r1",
    kind: "change",
    text: "Rename the project to Atlas and make sure the new name is saved.",
    check: { type: "control_transition", from: "project name", to: "Atlas" },
    persist: true
  }
  const judge = (
    requirement: AgentTaskRequirement,
    steps: AgentStepReadout[]
  ) =>
    judgeAgentCompletion({
      steps,
      observation: page(EDITOR, [control("e1", "Project name")]),
      evidenceLedger: [],
      requirements: [requirement],
      outcomes: [{ id: "r1", met: true, evidence: "Saved" }]
    })
  const saved = [click(1, "Save", { requirementId: "r1" })]

  it("says the save may have failed and to re-apply it once", () => {
    const judged = judge(rename, saved)
    expect(judged).toMatchObject({
      type: "refused",
      reason: "contradicted_state"
    })
    expect(judged.type === "refused" && judged.feedback).toMatch(
      /re-apply it once.*do not repeat it/u
    )
  })

  it("does not call a change unkept when the page cannot answer the check", () => {
    const field: AgentTaskRequirement = {
      id: "r1",
      kind: "change",
      text: "Rename the project to Atlas and make sure the new name is saved.",
      check: { type: "field", name: "Project name", value: "Atlas" },
      persist: true
    }
    const judgeOn = (elements: AgentObservation["elements"]) =>
      judgeAgentCompletion({
        steps: saved,
        observation: page(EDITOR, elements),
        evidenceLedger: [],
        requirements: [field],
        outcomes: [{ id: "r1", met: true, evidence: "Saved" }]
      })
    const input = (overrides: Partial<AgentObservation["elements"][number]>) =>
      control("e1", "Project name", {
        tag: "input",
        editable: true,
        value: "Atlas",
        ...overrides
      })
    for (const elements of [
      [input({}), input({ ref: "e5", value: "Old" })],
      [input({ valueTruncated: true })],
      [input({ invalid: true })]
    ]) {
      const judged = judgeOn(elements)
      expect(judged).toMatchObject({ type: "refused" })
      expect(judged.type === "refused" && judged.feedback).not.toMatch(
        /re-apply it once/u
      )
    }
    const old = judgeOn([input({ value: "Old" })])
    expect(old.type === "refused" && old.feedback).toMatch(/re-apply it once/u)
  })

  it("keeps never repeating for a change that need not be kept", () => {
    const judged = judge({ ...rename, persist: undefined }, saved)
    expect(judged.type === "refused" && judged.feedback).toMatch(
      /do not repeat a completed effect/u
    )
  })
})
