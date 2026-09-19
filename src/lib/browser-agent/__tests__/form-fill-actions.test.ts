import {
  type AgentCancellationSignal,
  AgentGroundingError,
  classifyAgentAffordance
} from "@ollama-client/agent-runtime"
import type {
  AgentCommand,
  AgentElement,
  AgentObservation
} from "@ollama-client/contracts"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { executeAgentFormFillInDocument } from "../command-executor"
import { createAgentElementReferenceStore } from "../element-references"
import { buildAgentElementObservation } from "../observation-builder"
import {
  type AgentEffectResolverAdapter,
  resolveFormFillAgentEffect
} from "../resolved-effect"

/**
 * A batched fill through the classifier, the resolver and the DOM backend.
 *
 * The rules worth pinning are the ones a batch has and a single edit does not:
 * every field is checked as the lone command it mirrors, the batch is refused
 * as a whole when its shape is wrong, and — the subtle one — it does not
 * refuse itself for the change it just made.
 */

const signal: AgentCancellationSignal = { aborted: false }

beforeEach(() => {
  document.title = "Profile"
  document.body.replaceChildren()
  history.replaceState({}, "", "/profile")
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
    width: 100,
    x: 0,
    y: 0,
    toJSON: () => ({})
  } as DOMRect)
})

const observation = (elements: AgentElement[]): AgentObservation =>
  ({
    snapshotId: "snapshot-1",
    generation: 1,
    tabId: 7,
    frameId: 0,
    documentId: "document-1",
    url: "https://example.com/profile",
    origin: "https://example.com",
    title: "Profile",
    frames: [
      {
        frameId: 0,
        documentId: "document-1",
        origin: "https://example.com",
        url: "https://example.com/profile",
        access: "ok",
        snapshotId: "snapshot-1",
        generation: 1
      }
    ],
    elements,
    visibleText: "",
    scroll: {
      x: 0,
      y: 0,
      viewportWidth: 1_000,
      viewportHeight: 800,
      documentWidth: 1_000,
      documentHeight: 800
    },
    dialogs: [],
    capturedAt: 1
  }) as unknown as AgentObservation

const resolverAdapter = (): AgentEffectResolverAdapter => ({
  getTab: async (tabId) => ({
    id: tabId,
    url: "https://example.com/profile"
  }),
  classifyAccess: async () => "ok",
  resolveHistoryDestination: async () => undefined
})

const form = (): {
  form: HTMLFormElement
  first: HTMLInputElement
  second: HTMLInputElement
  agree: HTMLInputElement
} => {
  const element = document.createElement("form")
  element.action = "https://example.com/profile"
  const first = document.createElement("input")
  first.type = "text"
  first.name = "given"
  first.setAttribute("aria-label", "Given name")
  const second = document.createElement("input")
  second.type = "text"
  second.name = "family"
  second.setAttribute("aria-label", "Family name")
  const agree = document.createElement("input")
  agree.type = "checkbox"
  agree.name = "agree"
  agree.setAttribute("aria-label", "Agree")
  element.append(first, second, agree)
  document.body.append(element)
  return { form: element, first, second, agree }
}

const live = (
  targets: Element[]
): {
  elements: AgentElement[]
  references: ReturnType<typeof createAgentElementReferenceStore>
} => {
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
  return { elements, references }
}

const fillForm = (fields: unknown[]): AgentCommand =>
  ({
    type: "fill_form",
    snapshotId: "snapshot-1",
    generation: 1,
    fields
  }) as AgentCommand

describe("fill_form affordances", () => {
  it("refuses a control named twice, because the later value would silently win", () => {
    const { first } = form()
    const { elements } = live([first])
    expect(
      classifyAgentAffordance(
        fillForm([
          { type: "clear_and_type", ref: "e1", text: "Ada" },
          { type: "clear_and_type", ref: "e1", text: "Grace" }
        ]),
        observation(elements)
      )
    ).toMatchObject({ reason: "duplicate_field", field: 1 })
  })

  it("names the field it refused, so the model does not have to guess which", () => {
    const { first, agree } = form()
    const { elements } = live([first, agree])
    expect(
      classifyAgentAffordance(
        fillForm([
          { type: "clear_and_type", ref: "e1", text: "Ada" },
          { type: "clear_and_type", ref: "e2", text: "not a checkbox value" }
        ]),
        observation(elements)
      )
    ).toMatchObject({ reason: "not_text_field", field: 1 })
  })

  it("refuses an unknown ref in the batch by its index", () => {
    const { first } = form()
    const { elements } = live([first])
    expect(
      classifyAgentAffordance(
        fillForm([
          { type: "clear_and_type", ref: "e1", text: "Ada" },
          { type: "clear_and_type", ref: "e9", text: "Lovelace" }
        ]),
        observation(elements)
      )
    ).toMatchObject({ reason: "unknown_ref", ref: "e9", field: 1 })
  })
})

describe("fill_form resolution", () => {
  it("keeps every field's own expectation, in the terms the lone command uses", async () => {
    const { first, second, agree } = form()
    const { elements } = live([first, second, agree])
    const effect = await resolveFormFillAgentEffect({
      command: fillForm([
        { type: "clear_and_type", ref: "e1", text: "Ada" },
        { type: "clear_and_type", ref: "e2", text: "Lovelace" },
        { type: "check", ref: "e3" }
      ]),
      observation: observation(elements),
      adapter: resolverAdapter()
    })
    expect(effect.semanticEffects).toEqual(["form_mutation"])
    expect(
      effect.batch?.fields.map((field) => field.target.expectedValue)
    ).toEqual(["Ada", "Lovelace", undefined])
    expect(effect.batch?.fields[2]?.target.expectedChecked).toBe(true)
  })

  it("refuses a batch touching a form that holds a sensitive control", async () => {
    const { form: element, first } = form()
    const password = document.createElement("input")
    password.type = "password"
    password.name = "secret"
    element.append(password)
    const { elements } = live([first])
    await expect(
      resolveFormFillAgentEffect({
        command: fillForm([{ type: "clear_and_type", ref: "e1", text: "Ada" }]),
        observation: observation(elements),
        adapter: resolverAdapter()
      })
    ).rejects.toBeInstanceOf(AgentGroundingError)
  })
})

describe("fill_form on the DOM backend", () => {
  const instructionFor = async (fields: unknown[]) => {
    const built = form()
    const { elements, references } = live([
      built.first,
      built.second,
      built.agree
    ])
    const effect = await resolveFormFillAgentEffect({
      command: fillForm(fields),
      observation: observation(elements),
      adapter: resolverAdapter()
    })
    const frame =
      effect.batch?.fields[0]?.target.frame ?? effect.snapshotIdentity
    return {
      built,
      references,
      instruction: {
        command: effect.command,
        snapshotIdentity: effect.snapshotIdentity,
        frame,
        fields: (effect.batch?.fields ?? []).map((field) => {
          const {
            frame: _frame,
            point: _point,
            noSubmitStep: _noSubmitStep,
            ...target
          } = field.target
          return {
            command: field.command,
            target: { ...target, ref: field.target.ref, frameId: 0 }
          }
        })
      }
    }
  }

  it("does not refuse itself for the change it just made", async () => {
    /**
     * `matchesFormState` catches the submitted payload moving between the
     * approval and the effect — and a multi-field fill moves it itself. Before
     * the batch re-baselined after each applied edit, field two was refused
     * for field one's change, every time, and a batch could never place more
     * than one value.
     */
    const { built, references, instruction } = await instructionFor([
      { type: "clear_and_type", ref: "e1", text: "Ada" },
      { type: "clear_and_type", ref: "e2", text: "Lovelace" },
      { type: "check", ref: "e3" }
    ])
    const outcome = executeAgentFormFillInDocument({
      instruction: instruction as never,
      document,
      references,
      signal
    })
    expect(outcome).toEqual({ applied: 3 })
    expect(built.first.value).toBe("Ada")
    expect(built.second.value).toBe("Lovelace")
    expect(built.agree.checked).toBe(true)
  })

  it("stops at the first field it cannot place and reports how far it got", async () => {
    const { built, references, instruction } = await instructionFor([
      { type: "clear_and_type", ref: "e1", text: "Ada" },
      { type: "clear_and_type", ref: "e2", text: "Lovelace" }
    ])
    /**
     * The page rewrites the second field's identity after the batch was
     * approved. The first edit has already landed, so the count is the one
     * fact the run cannot reconstruct afterwards — throwing here would lose
     * it, and a run that cannot tell one field written from none writes it
     * twice.
     */
    built.second.setAttribute("aria-label", "Something else entirely")
    const outcome = executeAgentFormFillInDocument({
      instruction: instruction as never,
      document,
      references,
      signal
    })
    expect(outcome.applied).toBe(1)
    expect(outcome.rejection).toBeDefined()
    expect(built.first.value).toBe("Ada")
    expect(built.second.value).toBe("")
  })

  it("raises rather than reporting a batch that placed nothing", async () => {
    /**
     * Nothing happened, so this is a refusal like any other: the run records
     * a rejected step and looks again. Reporting `applied: 0` as a receipt
     * would tell the verifier to confirm an effect that was never attempted.
     */
    const { built, references, instruction } = await instructionFor([
      { type: "clear_and_type", ref: "e1", text: "Ada" }
    ])
    built.first.setAttribute("aria-label", "Renamed before execution")
    expect(() =>
      executeAgentFormFillInDocument({
        instruction: instruction as never,
        document,
        references,
        signal
      })
    ).toThrow()
    expect(built.first.value).toBe("")
  })
})
