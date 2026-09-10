import {
  type AgentCancellationSignal,
  AgentEffectNotAppliedError,
  AgentGroundingError,
  type AuthorizedAgentEffect
} from "@ollama-client/agent-runtime"
import type {
  AgentCommand,
  AgentDialogState,
  AgentObservation
} from "@ollama-client/contracts"
import { describe, expect, it, vi } from "vitest"

import {
  type AgentCommandExecutorAdapter,
  executeDialogAgentEffect
} from "../command-executor"
import {
  type AgentEffectVerifierAdapter,
  verifyDialogAgentEffect
} from "../effect-verifier"
import {
  type AgentEffectResolverAdapter,
  resolveDialogAgentEffect,
  resolveDomMutationAgentEffect,
  resolveReadOnlyAgentEffect
} from "../resolved-effect"

const signal: AgentCancellationSignal = { aborted: false }

const confirmDialog: AgentDialogState = {
  id: "d1",
  type: "confirm",
  origin: "https://example.com",
  message: "Delete this project?"
}

const observation = (
  dialogs: AgentDialogState[] = [confirmDialog]
): AgentObservation => ({
  snapshotId: "snapshot-1",
  generation: 4,
  tabId: 7,
  frameId: 0,
  documentId: "document-1",
  url: "https://example.com/board",
  origin: "https://example.com",
  title: "Board",
  frames: [
    {
      frameId: 0,
      documentId: "document-1",
      origin: "https://example.com",
      access: "unreadable",
      snapshotId: "snapshot-1",
      generation: 4
    }
  ],
  elements: [],
  visibleText: "",
  scroll: {
    x: 0,
    y: 0,
    viewportWidth: 0,
    viewportHeight: 0,
    documentWidth: 0,
    documentHeight: 0
  },
  dialogs,
  capturedAt: 1
})

const answer = (
  overrides: Partial<Extract<AgentCommand, { type: "handle_dialog" }>> = {}
): AgentCommand => ({
  type: "handle_dialog",
  snapshotId: "snapshot-1",
  generation: 4,
  dialogId: "d1",
  accept: false,
  ...overrides
})

const resolverAdapter = (): AgentEffectResolverAdapter => ({
  getTab: async (tabId) => ({ id: tabId, url: "https://example.com/board" }),
  classifyAccess: async () => "ok",
  resolveHistoryDestination: async () => undefined
})

const resolve = (command: AgentCommand, before = observation()) =>
  resolveDialogAgentEffect({
    command,
    observation: before,
    adapter: resolverAdapter()
  })

const authorize = async (
  command: AgentCommand,
  before = observation()
): Promise<AuthorizedAgentEffect> => ({
  ...(await resolve(command, before)),
  authorization: { type: "policy", risk: "low", authorizedAt: 2 }
})

const executorAdapter = (
  overrides: Partial<AgentCommandExecutorAdapter> = {}
): AgentCommandExecutorAdapter => ({
  getTab: async (tabId) => ({ id: tabId, url: "https://example.com/board" }),
  getFrame: async () => ({
    documentId: "document-1",
    url: "https://example.com/board"
  }),
  classifyAccess: async () => "ok",
  scroll: vi.fn(),
  mutate: vi.fn(),
  activateTab: vi.fn(),
  goHistory: vi.fn(),
  resolveHistoryDestination: async () => undefined,
  wait: vi.fn(),
  navigate: vi.fn(),
  createTab: vi.fn(),
  handleDialog: async () => "answered",
  now: () => 10,
  ...overrides
})

const verifierAdapter = (
  after: AgentObservation
): AgentEffectVerifierAdapter => ({
  observe: async () => after,
  getActiveTabId: async () => 7,
  getTab: async () => ({ url: after.url }),
  classifyAccess: async () => "ok",
  now: () => 10
})

describe("resolveDialogAgentEffect", () => {
  it("prices dismissal as a dialog answer and nothing more", async () => {
    const effect = await resolve(answer())
    expect(effect.semanticEffects).toEqual(["dialog"])
    expect(effect.dialog).toEqual({ id: "d1", type: "confirm" })
  })

  it("prices accepting a confirm as destructive", async () => {
    const effect = await resolve(answer({ accept: true }))
    expect(effect.semanticEffects).toContain("destructive")
  })

  it("prices accepting a beforeunload as destructive", async () => {
    const before = observation([
      {
        id: "d1",
        type: "beforeunload",
        origin: "https://example.com",
        message: "Changes you made"
      }
    ])
    const effect = await resolve(answer({ accept: true }), before)
    expect(effect.semanticEffects).toContain("destructive")
  })

  it("leaves closing an alert free of any commitment", async () => {
    const before = observation([
      {
        id: "d1",
        type: "alert",
        origin: "https://example.com",
        message: "Saved"
      }
    ])
    const effect = await resolve(answer({ accept: true }), before)
    expect(effect.semanticEffects).toEqual(["dialog"])
  })

  it("carries an accepted prompt's text as a form mutation", async () => {
    const before = observation([
      {
        id: "d1",
        type: "prompt",
        origin: "https://example.com",
        message: "New name",
        defaultPrompt: "Board"
      }
    ])
    const effect = await resolve(
      answer({ accept: true, promptText: "Roadmap" }),
      before
    )
    expect(effect.semanticEffects).toEqual([
      "dialog",
      "destructive",
      "form_mutation"
    ])
  })

  it("shows the dialog's own words as the evidence the user reads", async () => {
    const effect = await resolve(answer({ accept: true }))
    expect(effect.target.accessibleName).toBe("Delete this project?")
  })

  it("acts on the page's own origin when the page raised it", async () => {
    const effect = await resolve(answer())
    expect(effect.frameOrigin).toBeUndefined()
    expect(effect.sourceOrigin).toBe("https://example.com")
  })

  it("acts on the frame's origin when a frame raised it", async () => {
    /**
     * An embedded frame's confirm blocks the whole tab, but answering it is
     * an effect on that frame's site — so policy judges the answer, its grant
     * offer and its allowlist against the frame, exactly as it does for a
     * child-frame element.
     */
    const before = observation([
      {
        id: "d1",
        type: "confirm",
        origin: "https://ads.example",
        message: "",
        unauthorizedOrigin: true
      }
    ])
    const effect = await resolve(answer({ accept: true }), before)
    expect(effect.frameOrigin).toBe("https://ads.example")
    expect(effect.sourceOrigin).toBe("https://example.com")
    expect(effect.target.accessibleName).toBeUndefined()
  })

  it("refuses an answer aimed at a dialog that is not the one open", async () => {
    await expect(resolve(answer({ dialogId: "d9" }))).rejects.toMatchObject({
      refusal: { reason: "unknown_dialog" }
    })
  })

  it("refuses prompt text offered to a dialog that takes none", async () => {
    await expect(
      resolve(answer({ accept: true, promptText: "x" }))
    ).rejects.toMatchObject({ refusal: { reason: "prompt_text_unsupported" } })
  })
})

describe("a page a dialog is holding", () => {
  it("refuses a read of a page nothing can read", async () => {
    await expect(
      resolveReadOnlyAgentEffect({
        command: { type: "read", snapshotId: "snapshot-1", generation: 4 },
        observation: observation(),
        adapter: resolverAdapter()
      })
    ).rejects.toBeInstanceOf(AgentGroundingError)
  })

  it("refuses a navigation while the dialog is unanswered", async () => {
    await expect(
      resolveDomMutationAgentEffect({
        command: {
          type: "click",
          ref: "e1",
          snapshotId: "snapshot-1",
          generation: 4
        },
        observation: observation(),
        adapter: resolverAdapter()
      })
    ).rejects.toMatchObject({ refusal: { reason: "dialog_open" } })
  })
})

describe("executeDialogAgentEffect", () => {
  it("answers the dialog through the debugger, not the document", async () => {
    const handleDialog = vi.fn(async () => "answered" as const)
    const getFrame = vi.fn()
    const receipt = await executeDialogAgentEffect({
      effect: await authorize(answer({ accept: true })),
      adapter: executorAdapter({ handleDialog, getFrame }),
      signal
    })
    expect(handleDialog).toHaveBeenCalledTimes(1)
    expect(getFrame).not.toHaveBeenCalled()
    expect(receipt.details).toBe("handle_dialog")
  })

  it("applies nothing when the prompt has already been replaced", async () => {
    await expect(
      executeDialogAgentEffect({
        effect: await authorize(answer()),
        adapter: executorAdapter({ handleDialog: async () => "not_open" }),
        signal
      })
    ).rejects.toBeInstanceOf(AgentEffectNotAppliedError)
  })

  it("applies nothing when the browser cannot answer a dialog", async () => {
    const adapter = executorAdapter()
    adapter.handleDialog = undefined
    await expect(
      executeDialogAgentEffect({
        effect: await authorize(answer()),
        adapter,
        signal
      })
    ).rejects.toBeInstanceOf(AgentEffectNotAppliedError)
  })

  it("refuses to answer once the tab has moved on", async () => {
    await expect(
      executeDialogAgentEffect({
        effect: await authorize(answer()),
        adapter: executorAdapter({
          getTab: async () => ({ url: "https://example.com/elsewhere" })
        }),
        signal
      })
    ).rejects.toThrow(/source tab changed/)
  })
})

describe("verifyDialogAgentEffect", () => {
  const verify = async (after: AgentObservation) =>
    verifyDialogAgentEffect({
      verification: {
        effect: await authorize(answer()),
        receipt: { executedAt: 10 },
        before: observation(),
        allowedOrigins: ["https://example.com"]
      },
      adapter: verifierAdapter(after),
      signal
    })

  it("confirms the answer when nothing holds the page", async () => {
    expect((await verify(observation([]))).outcome).toBe("confirmed")
  })

  it("reports a negative while the same prompt is still held", async () => {
    expect((await verify(observation())).outcome).toBe("negative")
  })

  it("reports ambiguity when the page immediately asks something else", async () => {
    const after = observation([
      {
        id: "d2",
        type: "confirm",
        origin: "https://example.com",
        message: "Really?"
      }
    ])
    expect((await verify(after)).outcome).toBe("ambiguous")
  })
})
