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
  frameOrigin?: string
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
  sourceOrigin: "https://example.com",
  ...(input.frameOrigin ? { frameOrigin: input.frameOrigin } : {})
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

describe("a dialog an embedded frame raised", () => {
  const frameDialog = (accept: boolean, frameOrigin: string) =>
    policyInput(
      dialogEffect({
        accept,
        type: "confirm",
        effects: accept ? ["dialog", "destructive"] : ["dialog"],
        frameOrigin
      })
    )

  it("asks before dismissing a dialog from a site the run may not read", () => {
    // Dismissal is free on the page's own dialog. A frame outside the
    // allowlist is a different site, and acting on it is the user's to
    // authorize even in the safe direction.
    const decision = evaluateAgentPolicy(
      frameDialog(false, "https://ads.example")
    )
    expect(decision.type).toBe("approval_required")
    if (decision.type !== "approval_required") return
    expect(decision.risk).toBe("high")
    expect(decision.request.action).toBe(
      "Dismiss https://ads.example's confirm dialog"
    )
    expect(decision.request.consequence).toContain("not authorized to read")
    /** A site outside the allowlist is never offered as a grant. */
    expect(decision.request.grantable).toBeUndefined()
  })

  it("names the frame, not the page, when asking to accept one", () => {
    const decision = evaluateAgentPolicy(
      frameDialog(true, "https://ads.example")
    )
    expect(decision.type).toBe("approval_required")
    if (decision.type !== "approval_required") return
    expect(decision.risk).toBe("critical")
    expect(decision.request.action).toBe(
      "Accept https://ads.example's confirm dialog"
    )
  })

  it("still dismisses an authorized frame's dialog without asking", () => {
    const decision = evaluateAgentPolicy({
      ...frameDialog(false, "https://widget.example"),
      allowedOrigins: ["https://example.com", "https://widget.example"]
    })
    expect(decision).toEqual({ type: "allow", risk: "low" })
  })
})

describe("a dialog on a top-level origin the run never approved", () => {
  /**
   * A page can navigate itself somewhere the run never approved. Every other
   * effect there already costs an approval by its own class — an activation
   * is high whatever page it is on — but a dismissal is low, so a dialog
   * would have been the one thing answerable for free on a site nobody
   * authorized.
   */
  const strayPage = (accept: boolean) => ({
    ...policyInput(
      dialogEffect({
        accept,
        type: "confirm",
        effects: accept ? ["dialog", "destructive"] : ["dialog"],
        message: "Are you sure?"
      })
    ),
    allowedOrigins: ["https://intended.example"]
  })

  it("asks before dismissing it, where the page's own dialog is free", () => {
    const decision = evaluateAgentPolicy(strayPage(false))
    expect(decision.type).toBe("approval_required")
    if (decision.type !== "approval_required") return
    expect(decision.risk).toBe("high")
    expect(decision.request.action).toBe(
      "Dismiss https://example.com's confirm dialog"
    )
  })

  it("names the site rather than calling it the page", () => {
    const decision = evaluateAgentPolicy(strayPage(true))
    if (decision.type !== "approval_required") throw new Error("expected one")
    expect(decision.request.action).toContain("https://example.com")
  })

  it("does not claim the text was withheld, because it was not", () => {
    // The root frame is not allowlist-gated, so the page's own dialog is
    // readable exactly as its body text is. Only a frame's text is withheld.
    const decision = evaluateAgentPolicy(strayPage(false))
    if (decision.type !== "approval_required") throw new Error("expected one")
    expect(decision.request.consequence).not.toContain("not authorized")
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

  const editEffect = (noSubmitStep: boolean): ResolvedAgentEffect => ({
    command: typing,
    target: {
      sensitive: false,
      maySubmit: false,
      accessibleName: "Document body",
      ...(noSubmitStep ? { noSubmitStep: true } : {})
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

  it("tells the user no submission will be asked about later", () => {
    const decision = evaluateAgentPolicy(policyInput(editEffect(true)))
    expect(decision.type).toBe("approval_required")
    if (decision.type !== "approval_required") return
    expect(decision.request.consequence).toContain("No submit step follows it")
    /**
     * Still grantable: the point is that the user grants against an accurate
     * sentence, not that an autosaving application costs a prompt per word.
     */
    expect(decision.request.grantable).toEqual(["form_mutation"])
  })

  it("does not claim the page stored anything, which it cannot know", () => {
    // Verification compares the control's value and nothing else, and a
    // standalone filter box with no submit step persists nothing at all.
    const decision = evaluateAgentPolicy(policyInput(editEffect(true)))
    if (decision.type !== "approval_required") throw new Error("expected one")
    expect(decision.request.consequence).toContain("may already be stored")
    expect(decision.request.consequence).not.toMatch(/\bis saved\b/)
  })

  it("says nothing of the sort when a submission is still to come", () => {
    const decision = evaluateAgentPolicy(policyInput(editEffect(false)))
    expect(decision.type).toBe("approval_required")
    if (decision.type !== "approval_required") return
    expect(decision.request.consequence).not.toContain("No submit step")
  })
})
