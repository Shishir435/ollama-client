import {
  type AgentCancellationSignal,
  AgentGroundingError,
  type AgentVerificationInput,
  type AuthorizedAgentEffect,
  evaluateAgentPolicy
} from "@ollama-client/agent-runtime"
import type { AgentElement, AgentObservation } from "@ollama-client/contracts"
import {
  type AgentCommand,
  AgentCommandSchema,
  type AgentSnapshotIdentity
} from "@ollama-client/contracts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  type AgentCommandExecutorAdapter,
  executeAgentDomMutationInDocument,
  executeDomMutationAgentEffect
} from "../command-executor"
import { agentEditorText } from "../editor-page"
import {
  type AgentEffectVerifierAdapter,
  verifyDomMutationAgentEffect
} from "../effect-verifier"
import { createAgentElementReferenceStore } from "../element-references"
import { buildAgentElementObservation } from "../observation-builder"
import {
  type AgentEffectResolverAdapter,
  resolveDomMutationAgentEffect
} from "../resolved-effect"

/**
 * Editors, in-place edits, drags and file choosers through the resolver,
 * the DOM backend and the verifier — what each is grounded in, what the page
 * receives, and what counts as the effect having happened.
 */

const signal: AgentCancellationSignal = { aborted: false }

beforeEach(() => {
  document.title = "Board"
  document.body.replaceChildren()
  history.replaceState({}, "", "/board")
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([
    {
      bottom: 20,
      height: 20,
      left: 0,
      right: 100,
      top: 0,
      width: 100
    } as DOMRect
  ] as unknown as DOMRectList)
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    bottom: 20,
    height: 20,
    left: 0,
    right: 100,
    top: 0,
    width: 100
  } as DOMRect)
})

afterEach(() => vi.restoreAllMocks())

const element = (overrides: Partial<AgentElement> = {}): AgentElement => ({
  ref: "e1",
  frameId: 0,
  tag: "div",
  type: "contenteditable",
  value: "Hello world",
  visible: true,
  enabled: true,
  editable: true,
  sensitive: false,
  multiline: true,
  ...overrides
})

const observation = (
  overrides: Partial<AgentObservation> = {}
): AgentObservation => ({
  snapshotId: "snapshot-1",
  generation: 1,
  tabId: 7,
  frameId: 0,
  documentId: "document-1",
  url: new URL("/board", location.href).href,
  origin: location.origin,
  title: "Board",
  frames: [
    {
      frameId: 0,
      documentId: "document-1",
      origin: location.origin,
      url: new URL("/board", location.href).href,
      access: "ok",
      snapshotId: "snapshot-1",
      generation: 1
    }
  ],
  elements: [element()],
  visibleText: "Hello world",
  scroll: {
    x: 0,
    y: 0,
    viewportWidth: 100,
    viewportHeight: 100,
    documentWidth: 100,
    documentHeight: 100
  },
  dialogs: [],
  capturedAt: 1,
  ...overrides
})

const command = (input: Record<string, unknown>): AgentCommand =>
  AgentCommandSchema.parse({
    ...input,
    snapshotId: "snapshot-1",
    generation: 1
  })

const resolverAdapter = (): AgentEffectResolverAdapter => ({
  getTab: async (tabId) => ({ id: tabId, url: observation().url }),
  classifyAccess: async () => "ok",
  resolveHistoryDestination: async () => undefined
})

const resolve = (action: AgentCommand, before = observation()) =>
  resolveDomMutationAgentEffect({
    command: action,
    observation: before,
    adapter: resolverAdapter()
  })

const authorize = async (
  action: AgentCommand,
  before = observation()
): Promise<AuthorizedAgentEffect> => ({
  ...(await resolve(action, before)),
  authorization: {
    type: "approval",
    risk: "high",
    approvalId: "a1",
    authorizedAt: 2
  }
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

const verify = async (
  action: AgentCommand,
  after: AgentObservation,
  before = observation(),
  receipt: AgentVerificationInput["receipt"] = { executedAt: 5 }
) =>
  verifyDomMutationAgentEffect({
    verification: {
      effect: await authorize(action, before),
      receipt,
      before,
      allowedOrigins: [location.origin]
    },
    adapter: verifierAdapter(after),
    signal
  })

const item = (ref: string, name: string): AgentElement =>
  element({
    ref,
    tag: "li",
    type: undefined,
    value: undefined,
    editable: false,
    multiline: undefined,
    draggable: true,
    name,
    verificationId: `v-${ref}`
  })

const column = (ref: string, name: string): AgentElement =>
  element({
    ref,
    tag: "ul",
    role: "list",
    type: undefined,
    value: undefined,
    editable: false,
    multiline: undefined,
    name,
    verificationId: `v-${ref}`
  })

describe("editing resolution", () => {
  it("resolves the value an in-place edit leaves behind", async () => {
    const resolved = await resolve(
      command({ type: "replace_text", ref: "e1", find: "world", text: "there" })
    )
    expect(resolved.target.expectedValue).toBe("Hello there")
    expect(resolved.semanticEffects).toEqual(["form_mutation"])
  })

  it("refuses an edit the observed value does not ground", async () => {
    await expect(
      resolve(
        command({ type: "replace_text", ref: "e1", find: "gone", text: "x" })
      )
    ).rejects.toBeInstanceOf(AgentGroundingError)
  })

  it("resolves a drag onto its destination and reads the destination's label for destructive intent", async () => {
    const before = observation({
      elements: [
        item("e1", "Task A"),
        column("e2", "Done"),
        column("e3", "Delete")
      ]
    })
    const moved = await resolve(
      command({ type: "drag", ref: "e1", to: "e2" }),
      before
    )
    expect(moved.semanticEffects).toEqual(["drag"])
    expect(moved.target.drop).toEqual({
      ref: "e2",
      verificationId: "v-e2",
      frameId: 0,
      tag: "ul",
      role: "list",
      accessibleName: "Done"
    })
    const binned = await resolve(
      command({ type: "drag", ref: "e1", to: "e3" }),
      before
    )
    expect(binned.semanticEffects).toEqual(["drag", "destructive"])
  })

  it("turns a click on a file input into a file-upload takeover", async () => {
    const before = observation({
      elements: [
        element({
          ref: "e1",
          tag: "input",
          type: "file",
          sensitive: true,
          value: undefined,
          multiline: undefined,
          editable: true
        })
      ]
    })
    const resolved = await resolve(
      command({ type: "click", ref: "e1" }),
      before
    )
    expect(resolved.semanticEffects).toContain("file_selection")
    const decision = evaluateAgentPolicy({
      runId: "run-1",
      stepId: "step-1",
      effect: resolved,
      allowedOrigins: [location.origin],
      scopedTabIds: [7],
      now: 3
    })
    expect(decision.type).toBe("takeover_required")
    if (decision.type === "takeover_required") {
      expect(decision.request.reason).toBe("file_upload")
    }
  })
})

describe("editing on the DOM backend", () => {
  const liveEffect = async (
    action: AgentCommand,
    targets: Element[]
  ): Promise<{
    effect: AuthorizedAgentEffect & { frame: AgentSnapshotIdentity }
    references: ReturnType<typeof createAgentElementReferenceStore>
  }> => {
    const references = createAgentElementReferenceStore({
      documentId: "document-1",
      frameId: 0
    })
    const snapshot = references.beginSnapshot({
      minimumGeneration: 1,
      createSnapshotId: () => "snapshot-1"
    })
    const elements = targets.map((target) =>
      buildAgentElementObservation(
        target,
        snapshot.reference(target),
        0,
        snapshot.verificationId(target)
      )
    )
    const effect = await authorize(action, observation({ elements }))
    return {
      effect: {
        ...effect,
        frame: effect.target.frame ?? effect.snapshotIdentity
      },
      references
    }
  }

  const editor = (html: string) => {
    const host = document.createElement("div")
    host.setAttribute("contenteditable", "true")
    host.setAttribute("aria-multiline", "true")
    host.innerHTML = html
    document.body.append(host)
    return host
  }

  it("appends, replaces and edits an editing host through its editing pipeline", async () => {
    const host = editor("<p>Hello world</p>")
    const inputs: string[] = []
    host.addEventListener("input", (event) =>
      inputs.push((event as InputEvent).inputType)
    )
    const typed = await liveEffect(
      command({ type: "type", ref: "e1", text: "\nSecond" }),
      [host]
    )
    executeAgentDomMutationInDocument({
      effect: typed.effect,
      document,
      references: typed.references,
      signal
    })
    expect(agentEditorText(host)).toBe("Hello world\nSecond")

    const edited = await liveEffect(
      command({
        type: "replace_text",
        ref: "e1",
        find: "world",
        text: "there"
      }),
      [host]
    )
    executeAgentDomMutationInDocument({
      effect: edited.effect,
      document,
      references: edited.references,
      signal
    })
    expect(agentEditorText(host)).toBe("Hello there\nSecond")

    const cleared = await liveEffect(
      command({ type: "clear_and_type", ref: "e1", text: "Fresh" }),
      [host]
    )
    executeAgentDomMutationInDocument({
      effect: cleared.effect,
      document,
      references: cleared.references,
      signal
    })
    expect(agentEditorText(host)).toBe("Fresh")
    expect(inputs).toEqual(["insertText", "insertText", "insertText"])
  })

  it("edits a text control in place and dispatches input", async () => {
    const input = document.createElement("input")
    input.value = "Hello world"
    document.body.append(input)
    const seen = vi.fn()
    input.addEventListener("input", seen)
    const { effect, references } = await liveEffect(
      command({
        type: "replace_text",
        ref: "e1",
        find: "world",
        text: "there"
      }),
      [input]
    )
    executeAgentDomMutationInDocument({ effect, document, references, signal })
    expect(input.value).toBe("Hello there")
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it("drags a board item onto a column with the page's own drop handlers", async () => {
    document.body.innerHTML =
      '<ul id="todo" role="list" aria-label="Todo"><li id="a" draggable="true">Task A</li></ul><ul id="done" role="list" aria-label="Done"></ul>'
    const li = document.getElementById("a") as HTMLElement
    const done = document.getElementById("done") as HTMLElement
    li.addEventListener("dragstart", (event) =>
      (event as DragEvent).dataTransfer?.setData("text/plain", "a")
    )
    done.addEventListener("dragover", (event) => event.preventDefault())
    done.addEventListener("drop", (event) => {
      const id = (event as DragEvent).dataTransfer?.getData("text/plain")
      if (id) done.append(document.getElementById(id) as Element)
    })
    const { effect, references } = await liveEffect(
      command({ type: "drag", ref: "e1", to: "e2" }),
      [li, done]
    )
    const adapter: AgentCommandExecutorAdapter = {
      getTab: async (tabId) => ({ id: tabId, url: observation().url }),
      getFrame: async () => ({
        documentId: "document-1",
        url: observation().url
      }),
      classifyAccess: async () => "ok",
      scroll: vi.fn(),
      mutate: async () => {
        executeAgentDomMutationInDocument({
          effect,
          document,
          references,
          signal
        })
        return undefined
      },
      activateTab: vi.fn(),
      goHistory: vi.fn(),
      resolveHistoryDestination: async () => undefined,
      wait: vi.fn(),
      navigate: vi.fn(),
      createTab: vi.fn(),
      now: () => 10
    }
    const receipt = await executeDomMutationAgentEffect({
      effect,
      adapter,
      signal
    })
    expect(receipt.backend).toBe("dom")
    expect(done.contains(li)).toBe(true)
  })

  it("marks the receipt when the action opened a file chooser the debugger held back", async () => {
    const button = document.createElement("button")
    button.textContent = "Upload"
    document.body.append(button)
    const { effect, references } = await liveEffect(
      command({ type: "click", ref: "e1" }),
      [button]
    )
    const adapter: AgentCommandExecutorAdapter = {
      getTab: async (tabId) => ({ id: tabId, url: observation().url }),
      getFrame: async () => ({
        documentId: "document-1",
        url: observation().url
      }),
      classifyAccess: async () => "ok",
      scroll: vi.fn(),
      mutate: async () => {
        executeAgentDomMutationInDocument({
          effect,
          document,
          references,
          signal
        })
        return undefined
      },
      fileChooserOpened: async () => true,
      activateTab: vi.fn(),
      goHistory: vi.fn(),
      resolveHistoryDestination: async () => undefined,
      wait: vi.fn(),
      navigate: vi.fn(),
      createTab: vi.fn(),
      now: () => 10
    }
    const receipt = await executeDomMutationAgentEffect({
      effect,
      adapter,
      signal
    })
    expect(receipt.fileChooser).toBe(true)
  })
})

describe("editing verification", () => {
  it("compares an editor's value in its normalized form", async () => {
    const after = observation({
      elements: [element({ value: "Hello  there" })]
    })
    const result = await verify(
      command({
        type: "replace_text",
        ref: "e1",
        find: "world",
        text: "there"
      }),
      after
    )
    expect(result.outcome).toBe("confirmed")
  })

  it("confirms a drag by the arrangement it leaves, not by the page having changed", async () => {
    const before = observation({
      elements: [
        item("e1", "Task A"),
        item("e2", "Task B"),
        column("e3", "Done")
      ],
      visibleText: "Task A Task B Done"
    })
    const drag = command({ type: "drag", ref: "e1", to: "e3" })
    const moved = observation({
      elements: [
        item("e2", "Task B"),
        column("e3", "Done"),
        item("e1", "Task A")
      ],
      visibleText: "Task B Done Task A"
    })
    expect(await verify(drag, moved, before)).toMatchObject({
      outcome: "confirmed",
      evidence: {
        kind: "arrangement",
        summary: expect.stringContaining("past")
      }
    })
    expect(await verify(drag, before, before)).toMatchObject({
      outcome: "negative",
      evidence: { summary: "Arrangement did not change" }
    })
    const restyled = observation({
      ...before,
      visibleText: "Task A Task B Done!"
    })
    expect(await verify(drag, restyled, before)).toMatchObject({
      outcome: "ambiguous",
      evidence: { summary: expect.stringContaining("did not visibly move") }
    })
    const gone = observation({
      elements: [item("e2", "Task B"), column("e3", "Done")],
      visibleText: "Task B Done"
    })
    expect(await verify(drag, gone, before)).toMatchObject({
      outcome: "confirmed",
      evidence: { summary: expect.stringContaining("no longer on the page") }
    })
  })

  it("confirms a drag that moved the item among different neighbours within one region", async () => {
    const before = observation({
      elements: [
        item("e1", "Task A"),
        item("e2", "Task B"),
        item("e3", "Task C")
      ],
      visibleText: "A B C"
    })
    const after = observation({
      elements: [
        item("e2", "Task B"),
        item("e1", "Task A"),
        item("e3", "Task C")
      ],
      visibleText: "B A C"
    })
    expect(
      await verify(
        command({ type: "drag", ref: "e1", to: "e2" }),
        after,
        before
      )
    ).toMatchObject({ outcome: "confirmed" })
  })

  it("leaves a step that opened a file chooser to the user", async () => {
    const before = observation({
      elements: [
        element({
          tag: "button",
          type: undefined,
          value: undefined,
          editable: false,
          multiline: undefined,
          name: "Upload"
        })
      ],
      visibleText: "Upload"
    })
    const result = await verify(
      command({ type: "click", ref: "e1" }),
      before,
      before,
      {
        executedAt: 5,
        backend: "cdp",
        inputDelivery: "delivered",
        fileChooser: true
      }
    )
    expect(result).toMatchObject({
      outcome: "ambiguous",
      evidence: { kind: "file_chooser" }
    })
  })
})
