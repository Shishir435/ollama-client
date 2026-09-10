import type { AgentCommand, AgentDialogState } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import { evaluateAgentPolicy } from "../policy"
import type {
  AgentPolicyInput,
  AgentSemanticEffect,
  ResolvedAgentEffect
} from "../ports"

const dialogCommand = (accept: boolean, promptText?: string): AgentCommand => ({
  type: "handle_dialog",
  snapshotId: "snapshot-1",
  generation: 1,
  dialogId: "d1",
  accept,
  ...(promptText === undefined ? {} : { promptText })
})

const dialogEffect = (input: {
  accept: boolean
  type: AgentDialogState["type"]
  effects: readonly AgentSemanticEffect[]
  message?: string
}): ResolvedAgentEffect => ({
  command: dialogCommand(input.accept),
  target: {
    sensitive: false,
    maySubmit: false,
    ...(input.message ? { accessibleName: input.message } : {})
  },
  dialog: { id: "d1", type: input.type },
  semanticEffects: input.effects,
  snapshotIdentity: {
    snapshotId: "snapshot-1",
    generation: 1,
    tabId: 1,
    frameId: 0,
    documentId: "document-1"
  },
  sourceUrl: "https://example.com/",
  sourceOrigin: "https://example.com"
})

const policyInput = (effect: ResolvedAgentEffect): AgentPolicyInput => ({
  runId: "run-1",
  stepId: "step-1",
  effect,
  allowedOrigins: ["https://example.com"],
  scopedTabIds: [1],
  now: 100
})

describe("dialog policy", () => {
  it("lets the run dismiss a dialog without asking", () => {
    const decision = evaluateAgentPolicy(
      policyInput(
        dialogEffect({ accept: false, type: "confirm", effects: ["dialog"] })
      )
    )
    expect(decision).toEqual({ type: "allow", risk: "low" })
  })

  it("lets the run close an alert without asking", () => {
    // An alert has one button and commits to nothing. A run that had to ask
    // before closing one could not get past a page that opens them.
    const decision = evaluateAgentPolicy(
      policyInput(
        dialogEffect({ accept: true, type: "alert", effects: ["dialog"] })
      )
    )
    expect(decision).toEqual({ type: "allow", risk: "low" })
  })

  it("asks before accepting a confirm, and never offers to widen it", () => {
    const decision = evaluateAgentPolicy(
      policyInput(
        dialogEffect({
          accept: true,
          type: "confirm",
          effects: ["dialog", "destructive"],
          message: "Delete this project?"
        })
      )
    )
    expect(decision.type).toBe("approval_required")
    if (decision.type !== "approval_required") return
    expect(decision.risk).toBe("critical")
    expect(decision.request.grantable).toBeUndefined()
    expect(decision.request.action).toBe("Accept the page's confirm dialog")
    expect(decision.request.pageEvidence).toBe("Delete this project?")
  })

  it("says what leaving a page with unsaved work costs", () => {
    const decision = evaluateAgentPolicy(
      policyInput(
        dialogEffect({
          accept: true,
          type: "beforeunload",
          effects: ["dialog", "destructive"]
        })
      )
    )
    expect(decision.type).toBe("approval_required")
    if (decision.type !== "approval_required") return
    expect(decision.request.consequence).toContain("discarded")
  })

  it("is not covered by a grant the user gave for the origin", () => {
    // Critical is never grantable, whatever a run was pre-authorized for:
    // these are the prompts that have to keep meaning something.
    const decision = evaluateAgentPolicy({
      ...policyInput(
        dialogEffect({
          accept: true,
          type: "confirm",
          effects: ["dialog", "destructive"]
        })
      ),
      grants: [
        {
          origin: "https://example.com",
          effects: ["activation", "form_mutation"],
          grantedAt: 1
        }
      ]
    })
    expect(decision.type).toBe("approval_required")
  })
})

describe("an edit with no submit step behind it", () => {
  const typing: AgentCommand = {
    type: "clear_and_type",
    ref: "e1",
    text: "Roadmap",
    snapshotId: "snapshot-1",
    generation: 1
  }

  const editEffect = (persistsOnChange: boolean): ResolvedAgentEffect => ({
    command: typing,
    target: {
      sensitive: false,
      maySubmit: false,
      accessibleName: "Document body",
      ...(persistsOnChange ? { persistsOnChange: true } : {})
    },
    semanticEffects: ["form_mutation"],
    snapshotIdentity: {
      snapshotId: "snapshot-1",
      generation: 1,
      tabId: 1,
      frameId: 0,
      documentId: "document-1"
    },
    sourceUrl: "https://example.com/",
    sourceOrigin: "https://example.com"
  })

  it("tells the user the change is saved as it is entered", () => {
    const decision = evaluateAgentPolicy(policyInput(editEffect(true)))
    expect(decision.type).toBe("approval_required")
    if (decision.type !== "approval_required") return
    expect(decision.request.consequence).toContain("no submit step")
    /**
     * Still grantable: the point is that the user grants against an accurate
     * sentence, not that an autosaving application costs a prompt per word.
     */
    expect(decision.request.grantable).toEqual(["form_mutation"])
  })

  it("says nothing of the sort when a submission is still to come", () => {
    const decision = evaluateAgentPolicy(policyInput(editEffect(false)))
    expect(decision.type).toBe("approval_required")
    if (decision.type !== "approval_required") return
    expect(decision.request.consequence).not.toContain("no submit step")
  })
})
