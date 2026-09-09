import {
  type AgentCancellationSignal,
  AgentEffectNotAppliedError,
  type AgentVerificationInput,
  type AuthorizedAgentEffect,
  classifyVerificationOutcome,
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
  DOM_MUTATION_AGENT_EXECUTORS,
  executeAgentDomMutationInDocument,
  executeDomMutationAgentEffect
} from "../command-executor"
import {
  type AgentEffectVerifierAdapter,
  DOM_MUTATION_AGENT_VERIFIERS,
  verifyDomMutationAgentEffect
} from "../effect-verifier"
import { createAgentElementReferenceStore } from "../element-references"
import { buildAgentElementObservation } from "../observation-builder"
import {
  type AgentEffectResolverAdapter,
  DOM_MUTATION_AGENT_ACTIONS,
  resolveDomMutationAgentEffect
} from "../resolved-effect"

const signal: AgentCancellationSignal = { aborted: false }

beforeEach(() => {
  document.title = "Form"
  document.body.replaceChildren()
  history.replaceState({}, "", "/form")
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
})

afterEach(() => vi.restoreAllMocks())

const element = (overrides: Partial<AgentElement> = {}): AgentElement => ({
  ref: "e1",
  frameId: 0,
  tag: "button",
  name: "Continue",
  visible: true,
  enabled: true,
  editable: false,
  sensitive: false,
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
  url: new URL("/form", location.href).href,
  origin: location.origin,
  title: "Form",
  frames: [
    {
      frameId: 0,
      documentId: "document-1",
      origin: location.origin,
      url: new URL("/form", location.href).href,
      access: "ok",
      snapshotId: "snapshot-1",
      generation: 1
    }
  ],
  elements: [element()],
  visibleText: "Continue",
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

const decide = async (action: AgentCommand, before = observation()) =>
  evaluateAgentPolicy({
    runId: "run-1",
    stepId: "step-1",
    effect: await resolve(action, before),
    allowedOrigins: [location.origin],
    scopedTabIds: [7],
    now: 3
  })

const verifierAdapter = (
  after: AgentObservation,
  overrides: Partial<AgentEffectVerifierAdapter> = {}
): AgentEffectVerifierAdapter => ({
  observe: async () => after,
  getActiveTabId: async () => 7,
  getTab: async () => ({ url: after.url }),
  classifyAccess: async () => "ok",
  now: () => 10,
  ...overrides
})

const verify = async (
  action: AgentCommand,
  after: AgentObservation,
  before = observation(),
  overrides: Partial<AgentEffectVerifierAdapter> = {}
) => {
  const verification: AgentVerificationInput = {
    effect: await authorize(action, before),
    receipt: { executedAt: 5 },
    before,
    allowedOrigins: [location.origin]
  }
  return verifyDomMutationAgentEffect({
    verification,
    adapter: verifierAdapter(after, overrides),
    signal
  })
}

const executorAdapter = (
  mutate: AgentCommandExecutorAdapter["mutate"]
): AgentCommandExecutorAdapter => ({
  getTab: async (tabId) => ({ id: tabId, url: observation().url }),
  getFrame: async () => ({
    documentId: "document-1",
    url: observation().url
  }),
  classifyAccess: async () => "ok",
  scroll: vi.fn(),
  mutate,
  activateTab: vi.fn(),
  goHistory: vi.fn(),
  resolveHistoryDestination: async () => undefined,
  wait: vi.fn(),
  navigate: vi.fn(),
  createTab: vi.fn(),
  now: () => 10
})

describe("Agent DOM mutation resolution and policy", () => {
  it("derives submission and formaction from a submit control", async () => {
    const destination = new URL("/finish", location.href).href
    const before = observation({
      elements: [
        element({
          type: "submit",
          formAction: destination,
          formMethod: "post",
          maySubmit: true,
          submitter: true
        })
      ]
    })
    const effect = await resolve(command({ type: "click", ref: "e1" }), before)
    expect(effect.semanticEffects).toEqual(["form_mutation", "submission"])
    expect(effect.destination).toEqual({
      url: destination,
      origin: location.origin,
      source: "observed"
    })
    const policy = await decide(command({ type: "click", ref: "e1" }), before)
    expect(policy.type).toBe("approval_required")
    expect(policy.risk).toBe("critical")
  })

  it("treats Enter in a form field as a critical submission", async () => {
    const before = observation({
      elements: [
        element({
          tag: "input",
          type: "text",
          editable: true,
          focused: true,
          maySubmit: true,
          formAction: new URL("/search", location.href).href
        })
      ]
    })
    const policy = await decide(
      command({ type: "press_key", ref: "e1", key: "Enter" }),
      before
    )
    expect(policy.type).toBe("approval_required")
    expect(policy.risk).toBe("critical")
  })

  it("uses the submitter formaction instead of a command-provided destination", async () => {
    const destination = "https://other.example/submit"
    const before = observation({
      elements: [
        element({
          type: "submit",
          formAction: destination,
          formMethod: "post",
          maySubmit: true,
          submitter: true
        })
      ]
    })
    const effect = await resolve(command({ type: "click", ref: "e1" }), before)
    expect(effect.destination?.url).toBe(destination)
    const policy = await decide(command({ type: "click", ref: "e1" }), before)
    expect(policy.type).toBe("approval_required")
    expect(policy.risk).toBe("critical")
  })

  it("requires takeover for sensitive and authentication controls", async () => {
    const sensitive = observation({
      elements: [
        element({
          tag: "input",
          type: "password",
          editable: true,
          sensitive: true
        })
      ]
    })
    const sensitivePolicy = await decide(
      command({ type: "clear_and_type", ref: "e1", text: "secret" }),
      sensitive
    )
    expect(sensitivePolicy.type).toBe("takeover_required")

    const authentication = observation({
      url: new URL("/login", location.href).href,
      elements: [
        element({ tag: "input", type: "email", editable: true, value: "" })
      ]
    })
    const authPolicy = await decide(
      command({ type: "type", ref: "e1", text: "a@example.com" }),
      authentication
    )
    expect(authPolicy.type).toBe("takeover_required")
  })

  it.each([
    "Delete account",
    "Konto löschen",
    "Eliminar cuenta",
    "Supprimer le compte",
    "खाता हटाएं",
    "Elimina account",
    "アカウントを削除",
    "Удалить аккаунт",
    "删除账户"
  ])("uses %s only as raise-only destructive evidence", async (name) => {
    const before = observation({ elements: [element({ name })] })
    const policy = await decide(command({ type: "click", ref: "e1" }), before)
    expect(policy.type).toBe("approval_required")
    expect(policy.risk).toBe("critical")
  })

  it("keeps an unrecognized activation at its safe high baseline", async () => {
    const before = observation({
      elements: [element({ name: "Unrecognized action" })]
    })
    await expect(
      decide(command({ type: "click", ref: "e1" }), before)
    ).resolves.toMatchObject({ type: "approval_required", risk: "high" })
  })

  it("resolves distinct append, replacement, selection, and checked states", async () => {
    const text = observation({
      elements: [
        element({ tag: "input", type: "text", editable: true, value: "old" })
      ]
    })
    await expect(
      resolve(command({ type: "type", ref: "e1", text: " next" }), text)
    ).resolves.toMatchObject({
      target: { observedValue: "old", expectedValue: "old next" },
      semanticEffects: ["form_mutation"]
    })
    await expect(
      resolve(command({ type: "clear_and_type", ref: "e1", text: "new" }), text)
    ).resolves.toMatchObject({ target: { expectedValue: "new" } })

    const select = observation({
      elements: [
        element({
          tag: "select",
          editable: true,
          value: "one",
          options: [
            { value: "one", label: "One", disabled: false },
            { value: "two", label: "Two", disabled: false }
          ]
        })
      ]
    })
    await expect(
      resolve(command({ type: "select", ref: "e1", value: "two" }), select)
    ).resolves.toMatchObject({ target: { expectedValue: "two" } })

    const checkbox = observation({
      elements: [element({ tag: "input", type: "checkbox", checked: false })]
    })
    await expect(
      resolve(command({ type: "check", ref: "e1" }), checkbox)
    ).resolves.toMatchObject({ target: { expectedChecked: true } })
    await expect(
      resolve(command({ type: "uncheck", ref: "e1" }), checkbox)
    ).resolves.toMatchObject({ target: { expectedChecked: false } })
  })

  it("rejects stale, unsupported, and ambiguous controls", async () => {
    // Each refusal now names its own reason. "Stale or ambiguous" covered two
    // unrelated answers, and the model could act on neither of them.
    await expect(
      resolve(command({ type: "click", ref: "missing" }))
    ).rejects.toThrow("not in the current observation")
    await expect(
      resolve(
        command({ type: "clear_and_type", ref: "e1", text: "x" }),
        observation({
          elements: [element({ tag: "div", role: "textbox", editable: true })]
        })
      )
    ).rejects.toThrow("does not accept typed text")
    await expect(
      resolve(
        command({ type: "uncheck", ref: "e1" }),
        observation({
          elements: [element({ tag: "input", type: "radio", checked: true })]
        })
      )
    ).rejects.toThrow("cannot be unchecked")
    await expect(
      resolve(
        command({ type: "clear_and_type", ref: "e1", text: "#000000" }),
        observation({
          elements: [
            element({ tag: "input", type: "color", editable: true, value: "" })
          ]
        })
      )
    ).rejects.toThrow("does not accept typed text")
  })

  it("classifies a reset control as form mutation", async () => {
    await expect(
      resolve(
        command({ type: "click", ref: "e1" }),
        observation({ elements: [element({ tag: "input", type: "reset" })] })
      )
    ).resolves.toMatchObject({ semanticEffects: ["form_mutation"] })
  })

  it("rejects a key action against a control that is not focused", async () => {
    await expect(
      resolve(
        command({ type: "press_key", ref: "e1", key: "Enter" }),
        observation({
          elements: [
            element({
              tag: "input",
              type: "text",
              editable: true,
              maySubmit: true,
              formAction: new URL("/search", location.href).href
            })
          ]
        })
      )
    ).rejects.toThrow("not focused")
  })
})

describe("Agent DOM mutation execution", () => {
  const liveEffect = async (
    action: AgentCommand,
    target: Element
  ): Promise<{
    effect: AuthorizedAgentEffect & { frame: AgentSnapshotIdentity }
    references: ReturnType<typeof createAgentElementReferenceStore>
  }> => {
    if (!target.isConnected) document.body.append(target)
    const references = createAgentElementReferenceStore({
      documentId: "document-1",
      frameId: 0
    })
    const snapshot = references.beginSnapshot({
      minimumGeneration: 1,
      createSnapshotId: () => "snapshot-1"
    })
    const ref = snapshot.reference(target)
    const before = observation({
      elements: [
        buildAgentElementObservation(
          target,
          ref,
          snapshot.verificationId(target)
        )
      ]
    })
    const effect = await authorize(action, before)
    return {
      effect: {
        ...effect,
        frame: effect.target.frame ?? effect.snapshotIdentity
      },
      references
    }
  }

  it("dispatches input without recording the field value in its receipt", async () => {
    const input = document.createElement("input")
    input.value = "old"
    const action = command({ type: "clear_and_type", ref: "e1", text: "new" })
    const { effect, references } = await liveEffect(action, input)
    const onInput = vi.fn()
    input.addEventListener("input", onInput)
    const mutate = vi.fn(async (authorized, activeSignal) =>
      executeAgentDomMutationInDocument({
        effect: authorized,
        document,
        references,
        signal: activeSignal
      })
    )
    const receipt = await executeDomMutationAgentEffect({
      effect,
      adapter: executorAdapter(mutate),
      signal
    })
    expect(input.value).toBe("new")
    expect(onInput).toHaveBeenCalledOnce()
    expect(receipt.details).toBe("clear_and_type")
    expect(JSON.stringify(receipt)).not.toContain("new")
  })

  it("sets select and checked state through native controls", async () => {
    const select = document.createElement("select")
    const first = document.createElement("option")
    first.value = "one"
    first.textContent = "One"
    const second = document.createElement("option")
    second.value = "two"
    second.textContent = "Two"
    select.append(first, second)
    select.value = "one"
    const selected = await liveEffect(
      command({ type: "select", ref: "e1", value: "two" }),
      select
    )
    executeAgentDomMutationInDocument({
      effect: selected.effect,
      document,
      references: selected.references,
      signal
    })
    expect(select.value).toBe("two")

    document.body.replaceChildren()
    const checkbox = document.createElement("input")
    checkbox.type = "checkbox"
    const checked = await liveEffect(
      command({ type: "check", ref: "e1" }),
      checkbox
    )
    executeAgentDomMutationInDocument({
      effect: checked.effect,
      document,
      references: checked.references,
      signal
    })
    expect(checkbox.checked).toBe(true)
  })

  it("rejects stale references and targets changed after approval", async () => {
    const input = document.createElement("input")
    input.value = "old"
    const action = command({ type: "clear_and_type", ref: "e1", text: "new" })
    const first = await liveEffect(action, input)
    first.references.invalidate()
    expect(() =>
      executeAgentDomMutationInDocument({
        effect: first.effect,
        document,
        references: first.references,
        signal
      })
    ).toThrow("snapshot is stale")

    document.body.replaceChildren()
    const changed = document.createElement("input")
    changed.value = "old"
    const second = await liveEffect(action, changed)
    changed.value = "user edit"
    expect(() =>
      executeAgentDomMutationInDocument({
        effect: second.effect,
        document,
        references: second.references,
        signal
      })
    ).toThrow("changed after approval")
    expect(changed.value).toBe("user edit")
  })

  it("refuses mutation if a formerly ordinary target becomes sensitive", async () => {
    const input = document.createElement("input")
    input.value = "old"
    const action = command({ type: "clear_and_type", ref: "e1", text: "new" })
    const { effect, references } = await liveEffect(action, input)
    input.type = "password"
    expect(() =>
      executeAgentDomMutationInDocument({
        effect,
        document,
        references,
        signal
      })
    ).toThrow("changed after approval")
    expect(input.value).toBe("old")
  })

  it("refuses a key action after the user moves focus", async () => {
    const input = document.createElement("input")
    const other = document.createElement("input")
    document.body.append(input, other)
    input.focus()
    const action = command({ type: "press_key", ref: "e1", key: "Enter" })
    const { effect, references } = await liveEffect(action, input)
    other.focus()

    expect(() =>
      executeAgentDomMutationInDocument({
        effect,
        document,
        references,
        signal
      })
    ).toThrow("changed after approval")
  })

  it("detects user edits elsewhere in a form after submit approval", async () => {
    const form = document.createElement("form")
    form.action = "/finish"
    const field = document.createElement("input")
    field.value = "original"
    const submit = document.createElement("button")
    submit.textContent = "Continue"
    form.append(field, submit)
    document.body.append(form)
    const action = command({ type: "click", ref: "e1" })
    const { effect, references } = await liveEffect(action, submit)
    field.value = "user edit"
    expect(() =>
      executeAgentDomMutationInDocument({
        effect,
        document,
        references,
        signal
      })
    ).toThrow("changed after approval")
  })

  it("detects hidden form-field changes without exposing their value", async () => {
    const form = document.createElement("form")
    form.action = "/finish"
    const hidden = document.createElement("input")
    hidden.type = "hidden"
    hidden.name = "routing-token"
    hidden.value = "recipient-a"
    const submit = document.createElement("button")
    submit.textContent = "Continue"
    form.append(hidden, submit)
    document.body.append(form)
    const { effect, references } = await liveEffect(
      command({ type: "click", ref: "e1" }),
      submit
    )
    expect(JSON.stringify(effect)).not.toContain("recipient-a")

    hidden.value = "recipient-b"
    expect(() =>
      executeAgentDomMutationInDocument({
        effect,
        document,
        references,
        signal
      })
    ).toThrow("form state changed after approval")
  })

  it("submits without invoking page-controlled click or submit handlers", async () => {
    const form = document.createElement("form")
    form.action = "/finish"
    const submit = document.createElement("button")
    submit.name = "intent"
    submit.value = "save"
    submit.textContent = "Continue"
    form.append(submit)
    document.body.append(form)
    const clickHandler = vi.fn(() => {
      form.action = "https://attacker.example/click"
    })
    const submitHandler = vi.fn((event: SubmitEvent) => {
      event.preventDefault()
      form.action = "https://attacker.example/submit"
    })
    submit.addEventListener("click", clickHandler)
    form.addEventListener("submit", submitHandler)
    const nativeSubmit = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => undefined)
    const { effect, references } = await liveEffect(
      command({ type: "click", ref: "e1" }),
      submit
    )

    const submissionUrl = executeAgentDomMutationInDocument({
      effect,
      document,
      references,
      signal
    })
    expect(submissionUrl).toBe(
      new URL("/finish?intent=save", location.href).href
    )
    expect(nativeSubmit).toHaveBeenCalledOnce()
    expect(clickHandler).not.toHaveBeenCalled()
    expect(submitHandler).not.toHaveBeenCalled()
    expect(form.action).toBe(new URL("/finish", location.href).href)
  })

  it("submits Enter through the guarded default submitter semantics", async () => {
    const form = document.createElement("form")
    form.action = "/search"
    form.method = "get"
    const input = document.createElement("input")
    input.name = "query"
    input.value = "safe value"
    const firstSubmitter = document.createElement("button")
    firstSubmitter.name = "intent"
    firstSubmitter.value = "archive"
    firstSubmitter.formAction = "/archive"
    firstSubmitter.formMethod = "post"
    firstSubmitter.textContent = "Archive"
    const secondSubmitter = document.createElement("button")
    secondSubmitter.name = "intent"
    secondSubmitter.value = "search"
    secondSubmitter.formAction = "/search"
    secondSubmitter.textContent = "Search"
    form.append(input, firstSubmitter, secondSubmitter)
    document.body.append(form)
    input.focus()
    const keyHandler = vi.fn(() => {
      form.action = "https://attacker.example/keypress"
    })
    input.addEventListener("keydown", keyHandler)
    let submittedForm: HTMLFormElement | undefined
    vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(function (
      this: HTMLFormElement
    ) {
      submittedForm = this
    })
    const { effect, references } = await liveEffect(
      command({ type: "press_key", ref: "e1", key: "Enter" }),
      input
    )

    expect(effect.target.formAction).toBe(
      new URL("/archive", location.href).href
    )
    expect(effect.target.formMethod).toBe("post")

    executeAgentDomMutationInDocument({
      effect,
      document,
      references,
      signal
    })
    expect(keyHandler).not.toHaveBeenCalled()
    expect(submittedForm?.action).toBe(new URL("/archive", location.href).href)
    expect(submittedForm?.method).toBe("post")
    expect(submittedForm?.querySelectorAll('input[name="query"]')).toHaveLength(
      1
    )
    expect(
      submittedForm?.querySelector<HTMLInputElement>('input[name="intent"]')
        ?.value
    ).toBe("archive")
    expect(
      submittedForm?.querySelectorAll('input[name="intent"]')
    ).toHaveLength(1)
  })

  it("navigates observed links without invoking page click handlers", async () => {
    const destination = new URL("/next", location.href).href
    const link = document.createElement("a")
    link.href = destination
    link.textContent = "Next"
    const clickHandler = vi.fn(() => {
      link.href = "https://attacker.example/"
    })
    link.addEventListener("click", clickHandler)
    const { effect } = await liveEffect(
      command({ type: "click", ref: "e1" }),
      link
    )
    const mutate = vi.fn()
    const adapter = executorAdapter(mutate)
    const navigate = vi.mocked(adapter.navigate)

    await executeDomMutationAgentEffect({ effect, adapter, signal })
    expect(navigate).toHaveBeenCalledWith(7, destination)
    expect(mutate).not.toHaveBeenCalled()
    expect(clickHandler).not.toHaveBeenCalled()
  })

  it("rechecks a resolved destination immediately before activation", async () => {
    const destination = "https://blocked.example/submit"
    const before = observation({
      elements: [
        element({
          type: "submit",
          formAction: destination,
          maySubmit: true,
          submitter: true
        })
      ]
    })
    const effect = await authorize(
      command({ type: "click", ref: "e1" }),
      before
    )
    const mutate = vi.fn()
    const adapter = executorAdapter(mutate)
    adapter.classifyAccess = async (url) =>
      url === destination ? "excluded" : "ok"

    await expect(
      executeDomMutationAgentEffect({ effect, adapter, signal })
    ).rejects.toThrow("tab access changed before execution")
    expect(mutate).not.toHaveBeenCalled()
  })
})

describe("Agent DOM mutation verification", () => {
  const fieldBefore = (value: string) =>
    observation({
      elements: [
        element({
          tag: "input",
          type: "text",
          editable: true,
          value
        })
      ]
    })

  const fieldAfter = (value: string) =>
    observation({
      snapshotId: "snapshot-2",
      generation: 2,
      elements: [
        element({
          ref: "e9",
          tag: "input",
          type: "text",
          editable: true,
          value
        })
      ]
    })

  it.each([
    ["confirmed", "new"],
    ["negative", "old"],
    ["ambiguous", "user edit"]
  ] as const)("classifies field verification as %s", async (expected, value) => {
    const action = command({
      type: "clear_and_type",
      ref: "e1",
      text: "new"
    })
    await expect(
      verify(action, fieldAfter(value), fieldBefore("old"))
    ).resolves.toMatchObject({ outcome: expected })
  })

  it("verifies field state without echoing its value into evidence", async () => {
    const secretLikeValue = "private-profile-value"
    const result = await verify(
      command({
        type: "clear_and_type",
        ref: "e1",
        text: secretLikeValue
      }),
      fieldAfter(secretLikeValue),
      fieldBefore("old")
    )
    expect(result.outcome).toBe("confirmed")
    expect(JSON.stringify(result)).not.toContain(secretLikeValue)
  })

  it("uses an extension-issued identity to verify repeated controls", async () => {
    const before = observation({
      elements: [
        element({
          ref: "e1",
          verificationId: "control-a",
          tag: "input",
          type: "text",
          name: "Quantity",
          editable: true,
          value: "old"
        }),
        element({
          ref: "e2",
          verificationId: "control-b",
          tag: "input",
          type: "text",
          name: "Quantity",
          editable: true,
          value: "old"
        })
      ]
    })
    const after = observation({
      snapshotId: "snapshot-2",
      generation: 2,
      elements: [
        element({
          ref: "e8",
          verificationId: "control-a",
          tag: "input",
          type: "text",
          name: "Quantity",
          editable: true,
          value: "old"
        }),
        element({
          ref: "e9",
          verificationId: "control-b",
          tag: "input",
          type: "text",
          name: "Quantity",
          editable: true,
          value: "new"
        })
      ]
    })

    await expect(
      verify(
        command({ type: "clear_and_type", ref: "e2", text: "new" }),
        after,
        before
      )
    ).resolves.toMatchObject({ outcome: "confirmed" })
  })

  it("treats an unexpected checked state as user interference", async () => {
    const before = observation({
      elements: [element({ tag: "input", type: "checkbox", checked: false })]
    })
    const after = observation({
      snapshotId: "snapshot-2",
      generation: 2,
      elements: [element({ ref: "e9", tag: "input", type: "checkbox" })]
    })
    await expect(
      verify(command({ type: "check", ref: "e1" }), after, before)
    ).resolves.toMatchObject({ outcome: "ambiguous" })
  })

  it("does not permit an inconclusive submission to be retried", async () => {
    const destination = observation().url
    const before = observation({
      elements: [
        element({
          type: "submit",
          maySubmit: true,
          submitter: true,
          formAction: destination
        })
      ]
    })
    const result = await verify(
      command({ type: "click", ref: "e1" }),
      { ...before, snapshotId: "snapshot-2", generation: 2, capturedAt: 2 },
      before
    )
    expect(result.outcome).toBe("ambiguous")
    expect(classifyVerificationOutcome(result, "critical")).toEqual({
      type: "pause",
      stepStatus: "uncertain",
      reason: "unresolved_effect",
      retryAllowed: false
    })
  })

  it("confirms same-URL submission only after observable page change", async () => {
    const destination = observation().url
    const before = observation({
      elements: [
        element({
          type: "submit",
          maySubmit: true,
          submitter: true,
          formAction: destination
        })
      ]
    })
    const after = observation({
      snapshotId: "snapshot-2",
      generation: 2,
      visibleText: "Saved",
      elements: []
    })
    await expect(
      verify(command({ type: "click", ref: "e1" }), after, before)
    ).resolves.toMatchObject({ outcome: "confirmed" })
  })

  it("ships one resolver, executor, and verifier entry for every mutation action", () => {
    expect(Object.keys(DOM_MUTATION_AGENT_EXECUTORS).sort()).toEqual(
      [...DOM_MUTATION_AGENT_ACTIONS].sort()
    )
    expect(Object.keys(DOM_MUTATION_AGENT_VERIFIERS).sort()).toEqual(
      [...DOM_MUTATION_AGENT_ACTIONS].sort()
    )
  })
})

describe("Agent DOM mutation across frames", () => {
  const childFrame = {
    frameId: 2,
    parentFrameId: 0,
    documentId: "document-2",
    origin: location.origin,
    url: new URL("/child", location.href).href,
    access: "ok" as const,
    snapshotId: "snapshot-child",
    generation: 4
  }
  const framed = (overrides: Partial<AgentObservation> = {}) => {
    const base = observation(overrides)
    return {
      ...base,
      frames: [base.frames[0], childFrame],
      elements: [
        element(),
        element({ ref: "f2e1", frameId: 2 }),
        ...(overrides.elements ?? [])
      ]
    }
  }

  it("binds a child-frame target to its own frame identity", async () => {
    const effect = await resolve(
      command({ type: "click", ref: "f2e1" }),
      framed()
    )
    expect(effect.snapshotIdentity).toMatchObject({
      snapshotId: "snapshot-1",
      frameId: 0,
      documentId: "document-1"
    })
    expect(effect.target.frameId).toBe(2)
    expect(effect.target.frame).toEqual({
      snapshotId: "snapshot-child",
      generation: 4,
      tabId: 7,
      frameId: 2,
      documentId: "document-2"
    })
  })

  it("tells policy where a child-frame effect really happens", async () => {
    const before = framed()
    before.frames[1] = {
      ...childFrame,
      origin: "https://widgets.example",
      url: "https://widgets.example/login"
    }
    const effect = await resolve(
      command({ type: "click", ref: "f2e1" }),
      before
    )
    expect(effect.sourceUrl).toBe(observation().url)
    expect(effect.frameUrl).toBe("https://widgets.example/login")
    expect(effect.frameOrigin).toBe("https://widgets.example")
    expect(effect.semanticEffects).toContain("authentication")
    const root = await resolve(command({ type: "click", ref: "e1" }), before)
    expect(root.frameOrigin).toBeUndefined()
  })

  it("keeps the root target bound to the root frame", async () => {
    const effect = await resolve(
      command({ type: "click", ref: "e1" }),
      framed()
    )
    expect(effect.target.frame).toEqual(effect.snapshotIdentity)
  })

  it("refuses to execute once the target's frame holds another document", async () => {
    const mutate = vi.fn()
    const effect = await authorize(
      command({ type: "click", ref: "f2e1" }),
      framed()
    )
    const getFrame = vi.fn(async (_tabId: number, frameId: number) =>
      frameId === 0
        ? { documentId: "document-1", url: observation().url }
        : { documentId: "document-replaced", url: childFrame.url }
    )
    await expect(
      executeDomMutationAgentEffect({
        effect,
        adapter: { ...executorAdapter(mutate), getFrame },
        signal
      })
    ).rejects.toBeInstanceOf(AgentEffectNotAppliedError)
    expect(getFrame).toHaveBeenCalledWith(7, 2)
    expect(mutate).not.toHaveBeenCalled()
  })

  it("executes a child-frame mutation once its frame still holds the observed document", async () => {
    const mutate = vi.fn(async () => undefined)
    const effect = await authorize(
      command({ type: "click", ref: "f2e1" }),
      framed()
    )
    await executeDomMutationAgentEffect({
      effect,
      adapter: {
        ...executorAdapter(mutate),
        getFrame: async (_tabId, frameId) =>
          frameId === 0
            ? { documentId: "document-1", url: observation().url }
            : { documentId: "document-2", url: childFrame.url }
      },
      signal
    })
    expect(mutate).toHaveBeenCalledOnce()
  })

  it("tells identical controls apart by frame when verifying", async () => {
    const input = (ref: string, frameId: number, value: string) =>
      element({
        ref,
        frameId,
        tag: "input",
        type: "text",
        name: "Search",
        value,
        editable: true
      })
    const before = {
      ...framed(),
      elements: [input("e1", 0, ""), input("f2e1", 2, "")]
    }
    const after = {
      ...before,
      generation: 2,
      elements: [input("e1", 0, "hello"), input("f2e1", 2, "")]
    }
    const verification = await verify(
      command({ type: "type", ref: "e1", text: "hello" }),
      after,
      before
    )
    expect(verification.outcome).toBe("confirmed")
  })
})
