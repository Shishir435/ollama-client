import type {
  AgentCancellationSignal,
  AgentExecutionReceipt,
  AuthorizedAgentEffect
} from "@ollama-client/agent-runtime"
import { AgentEffectNotAppliedError } from "@ollama-client/agent-runtime"
import {
  type AgentSnapshotIdentity,
  parseAgentKeyCombination
} from "@ollama-client/contracts"

import type { TabAccess } from "@/lib/browser-tab-access"
import { executeAgentSyntheticDrag } from "./drag-page"
import {
  insertAgentEditableText,
  isAgentEditingHost,
  placeAgentEditableCaret,
  selectAgentEditableText
} from "./editor-page"
import type { AgentElementReferenceStore } from "./element-references"
import {
  type AgentInputBackendChoice,
  type AgentInputPlatform,
  type AgentInputPoint,
  type AgentInputTrace,
  AgentNativeInputCancelledError,
  AgentNativeInputFailedError,
  type AgentNativeInputPlan,
  agentNativeKeyDefinition,
  assessAgentInputDelivery,
  chooseAgentInputBackend,
  planAgentNativeInput,
  planAgentWheel
} from "./native-input"
import {
  type AgentFormSubmitter,
  buildAgentElementObservation,
  resolveAgentFormSubmitter
} from "./observation-builder"
import type {
  DomMutationAgentAction,
  NavigationAgentAction,
  ReadOnlyAgentAction
} from "./resolved-effect"

export const executeAgentScrollInDocument = (input: {
  command: Extract<AuthorizedAgentEffect["command"], { type: "scroll" }>
  /** The identity of the frame this document is, as the store knows it. */
  identity: AgentSnapshotIdentity
  document: Document
  references: AgentElementReferenceStore
}): void => {
  const identity = input.identity
  if (!input.references.matches(identity)) {
    throw new Error("Agent scroll snapshot is stale")
  }
  if (input.command.ref) {
    const target = input.references.resolve(input.command.ref, identity)
    if (!target) throw new Error("Agent scroll target is stale")
    target.scrollIntoView({ block: "center", inline: "center" })
    return
  }
  const view = input.document.defaultView
  if (!view) throw new Error("Agent scroll window is unavailable")
  const amount =
    input.command.amount ??
    (input.command.direction === "up" || input.command.direction === "down"
      ? view.innerHeight * 0.8
      : view.innerWidth * 0.8)
  view.scrollBy({
    behavior: "instant",
    left:
      input.command.direction === "left"
        ? -amount
        : input.command.direction === "right"
          ? amount
          : 0,
    top:
      input.command.direction === "up"
        ? -amount
        : input.command.direction === "down"
          ? amount
          : 0
  })
}

const setNativeValue = (
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string
): void => {
  const prototype =
    element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLSelectElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
  if (!setter) throw new Error("Agent control has no native value setter")
  setter.call(element, value)
}

const setNativeChecked = (
  element: HTMLInputElement,
  checked: boolean
): void => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "checked"
  )?.set
  if (!setter) throw new Error("Agent control has no native checked setter")
  setter.call(element, checked)
}

const dispatchFormEvents = (element: Element, includeChange: boolean): void => {
  element.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
  if (includeChange) {
    element.dispatchEvent(
      new Event("change", { bubbles: true, composed: true })
    )
  }
}

export type AgentDomMutationInstruction = Pick<
  AuthorizedAgentEffect,
  "command" | "target" | "snapshotIdentity"
> & {
  /**
   * The frame the target lives in, with that frame's own snapshot. The root
   * identity above is what the command named; this is what the document that
   * executes the mutation checks against its own reference store.
   */
  frame: AgentSnapshotIdentity
  /** The CSS point a visual click aims at; absent means the control's own centre. */
  point?: { x: number; y: number }
}

const sameOptional = <T>(first: T | undefined, second: T | undefined) =>
  first === second

const assertUnchangedMutationTarget = (
  effect: AgentDomMutationInstruction,
  element: Element
): void => {
  const ref = effect.target.ref
  if (!ref || !element.isConnected) {
    throw new AgentEffectNotAppliedError("Agent mutation target was replaced")
  }
  const current = buildAgentElementObservation(
    element,
    ref,
    effect.frame.frameId
  )
  const expected = effect.target
  const matches =
    current.visible &&
    current.enabled &&
    current.frameId === expected.frameId &&
    current.tag === expected.tag &&
    sameOptional(current.role, expected.role) &&
    sameOptional(current.name, expected.accessibleName) &&
    sameOptional(current.type, expected.inputType) &&
    sameOptional(current.value, expected.observedValue) &&
    sameOptional(current.checked, expected.observedChecked) &&
    sameOptional(current.focused, expected.observedFocused) &&
    sameOptional(current.href, expected.href) &&
    sameOptional(current.formAction, expected.formAction) &&
    sameOptional(current.formMethod, expected.formMethod) &&
    sameOptional(current.formFingerprint, expected.formFingerprint) &&
    sameOptional(
      current.formHasSensitiveControl,
      expected.formHasSensitiveControl
    ) &&
    Boolean(current.submitter) === Boolean(expected.submitter) &&
    Boolean(current.maySubmit) === expected.maySubmit &&
    current.sensitive === expected.sensitive
  if (!matches)
    throw new AgentEffectNotAppliedError(
      "Agent mutation target changed after approval"
    )
}

/**
 * Text into an editing host goes through the browser's editing pipeline —
 * caret placed, then `insertText` — never through `textContent`: a rich-text
 * editor rebuilds its DOM from its own model on the next keystroke and would
 * discard anything written behind its back. The resolved value is what the
 * verifier compares afterwards; it is not assigned.
 */
const executeEditorTextMutation = (
  effect: AgentDomMutationInstruction,
  host: Element
): void => {
  const apply = (text: string): void => {
    if (!insertAgentEditableText(host, text)) {
      throw new AgentEffectNotAppliedError(
        "Agent cannot edit this host through the browser's editing pipeline"
      )
    }
  }
  switch (effect.command.type) {
    case "type":
      placeAgentEditableCaret(host, "end")
      apply(effect.command.text)
      return
    case "clear_and_type":
      placeAgentEditableCaret(host, "all")
      apply(effect.command.text)
      return
    case "replace_text":
      if (!selectAgentEditableText(host, effect.command.find)) {
        throw new AgentEffectNotAppliedError(
          "Agent text to replace is no longer unique in the target"
        )
      }
      apply(effect.command.text)
      return
    default:
      throw new Error("Invalid Agent editor text effect")
  }
}

const executeTextMutation = (
  effect: AgentDomMutationInstruction,
  element: Element
): void => {
  if (isAgentEditingHost(element)) {
    executeEditorTextMutation(effect, element)
    return
  }
  if (
    !(element instanceof HTMLInputElement) &&
    !(element instanceof HTMLTextAreaElement)
  ) {
    throw new Error("Agent text target is no longer supported")
  }
  if (effect.target.expectedValue === undefined) {
    throw new Error("Agent text effect has no resolved value")
  }
  /**
   * A replacement is grounded in the live value too: the run it names has to
   * still be there once, or the resolved value describes a field that moved.
   */
  if (
    effect.command.type === "replace_text" &&
    !selectAgentEditableText(element, effect.command.find)
  ) {
    throw new AgentEffectNotAppliedError(
      "Agent text to replace is no longer unique in the target"
    )
  }
  setNativeValue(element, effect.target.expectedValue)
  dispatchFormEvents(element, false)
}

const executeSelectionMutation = (
  effect: AgentDomMutationInstruction,
  element: Element
): void => {
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error("Agent select target is no longer supported")
  }
  const expected = effect.target.expectedValue
  const matches = Array.from(element.options).filter(
    (option) => option.value === expected && !option.disabled
  )
  if (expected === undefined || matches.length !== 1) {
    throw new Error("Agent select option changed after approval")
  }
  setNativeValue(element, expected)
  dispatchFormEvents(element, true)
}

const executeCheckedMutation = (
  effect: AgentDomMutationInstruction,
  element: Element
): void => {
  if (!(element instanceof HTMLInputElement)) {
    throw new Error("Agent check target is no longer supported")
  }
  const expected = effect.target.expectedChecked
  if (expected === undefined) {
    throw new Error("Agent check effect has no resolved state")
  }
  setNativeChecked(element, expected)
  dispatchFormEvents(element, true)
}

const associatedForm = (element: Element): HTMLFormElement | null =>
  element instanceof HTMLButtonElement ||
  element instanceof HTMLInputElement ||
  element instanceof HTMLSelectElement ||
  element instanceof HTMLTextAreaElement
    ? element.form
    : null

const successfulControlValues = (
  control: Element
): readonly string[] | undefined => {
  if (
    !(control instanceof HTMLInputElement) &&
    !(control instanceof HTMLSelectElement) &&
    !(control instanceof HTMLTextAreaElement)
  ) {
    return undefined
  }
  if (!control.name || control.matches(":disabled")) return undefined
  if (control instanceof HTMLInputElement) {
    const type = control.type.toLowerCase()
    if (["button", "file", "image", "reset", "submit"].includes(type)) {
      return undefined
    }
    if (["checkbox", "radio"].includes(type) && !control.checked) {
      return undefined
    }
    return [control.value]
  }
  if (control instanceof HTMLSelectElement) {
    return Array.from(control.selectedOptions)
      .filter(
        (option) =>
          !option.disabled &&
          !(
            option.parentElement instanceof HTMLOptGroupElement &&
            option.parentElement.disabled
          )
      )
      .map((option) => option.value)
  }
  return [control.value]
}

const appendSubmissionValue = (
  form: HTMLFormElement,
  name: string,
  value: string
): void => {
  const field = form.ownerDocument.createElement("input")
  field.type = "hidden"
  field.name = name
  field.value = value
  form.append(field)
}

/**
 * Native click/requestSubmit run page handlers before the browser consumes the
 * destination. Submit a fresh form containing only the already-bound standard
 * controls, so page listeners cannot swap the approved target during the
 * activation event. Sensitive and file controls are rejected by policy first.
 */
const buildGuardedSubmission = (
  form: HTMLFormElement,
  submitter: AgentFormSubmitter | undefined,
  destination: string,
  method: "get" | "post"
): HTMLFormElement => {
  const guarded = form.ownerDocument.createElement("form")
  guarded.hidden = true
  guarded.action = destination
  guarded.method = method
  guarded.enctype = submitter?.formEnctype || form.enctype
  guarded.acceptCharset = form.acceptCharset
  guarded.target = "_self"
  for (const control of Array.from(form.elements)) {
    const values =
      control instanceof Element ? successfulControlValues(control) : undefined
    if (!values || !("name" in control)) continue
    for (const value of values) {
      appendSubmissionValue(guarded, String(control.name), value)
    }
  }
  if (submitter?.name) {
    if (
      submitter instanceof HTMLInputElement &&
      submitter.type.toLowerCase() === "image"
    ) {
      appendSubmissionValue(guarded, `${submitter.name}.x`, "0")
      appendSubmissionValue(guarded, `${submitter.name}.y`, "0")
    } else {
      appendSubmissionValue(guarded, submitter.name, submitter.value)
    }
  }
  return guarded
}

const submitWithoutPageHandlers = (
  effect: AgentDomMutationInstruction,
  element: Element
): string => {
  const form = associatedForm(element)
  const destination = effect.target.formAction
  if (!form || !destination || !effect.target.formMethod) {
    throw new Error("Agent submit target is no longer supported")
  }
  if (effect.target.formMethod === "dialog") {
    throw new Error("Agent dialog form submission requires takeover")
  }
  const submitter = resolveAgentFormSubmitter(element)
  if (submitter?.matches(":disabled")) {
    throw new Error("Agent form submitter is disabled")
  }
  const skipsValidation = form.noValidate || Boolean(submitter?.formNoValidate)
  const invalid = Array.from(form.elements).some(
    (control) =>
      (control instanceof HTMLButtonElement ||
        control instanceof HTMLInputElement ||
        control instanceof HTMLSelectElement ||
        control instanceof HTMLTextAreaElement) &&
      control.willValidate &&
      !control.validity.valid
  )
  if (!skipsValidation && invalid) {
    throw new Error("Agent form is not valid for submission")
  }

  const guarded = buildGuardedSubmission(
    form,
    submitter,
    destination,
    effect.target.formMethod
  )
  const submitted = new URL(destination)
  if (effect.target.formMethod === "get") {
    const query = new URLSearchParams()
    for (const control of Array.from(guarded.elements)) {
      if (control instanceof HTMLInputElement)
        query.append(control.name, control.value)
    }
    submitted.search = query.toString()
  }
  try {
    element.ownerDocument.body.append(guarded)
    HTMLFormElement.prototype.submit.call(guarded)
  } finally {
    guarded.remove()
  }
  return submitted.href
}

const executeKey = (
  effect: AgentDomMutationInstruction,
  element: Element
): string | undefined => {
  if (effect.command.type !== "press_key") {
    throw new Error("Invalid Agent key effect")
  }
  if (effect.command.key === "Enter" && effect.target.maySubmit) {
    return submitWithoutPageHandlers(effect, element)
  }
  /**
   * The chord is spelled out as a page would see it from a keyboard: the key
   * itself in `key`, each modifier as its flag, and the code and virtual key
   * where the table knows them. The command's own string is the grammar, not
   * an event field — `Control+é` is a chord, not a key named that.
   */
  const combination = parseAgentKeyCombination(effect.command.key)
  if (!combination) throw new Error("Agent key combination is invalid")
  const definition = agentNativeKeyDefinition(combination.key)
  const init: KeyboardEventInit = {
    key: definition?.key ?? combination.key,
    ...(definition?.code ? { code: definition.code } : {}),
    ...(definition?.keyCode !== undefined
      ? { keyCode: definition.keyCode }
      : {}),
    ctrlKey: combination.modifiers.includes("Control"),
    shiftKey: combination.modifiers.includes("Shift"),
    altKey: combination.modifiers.includes("Alt"),
    metaKey: combination.modifiers.includes("Meta"),
    bubbles: true,
    cancelable: true,
    composed: true
  }
  element.dispatchEvent(new KeyboardEvent("keydown", init))
  element.dispatchEvent(new KeyboardEvent("keyup", init))
}

/**
 * The live element an approved instruction still names, or a typed refusal.
 *
 * Every check here is one the approval was given against: the snapshot the
 * reference was bound in, the element it resolves to, the form state around
 * it and the observed facts about it. Native and synthetic execution share the
 * function so the two backends cannot drift in what they refuse.
 */
export const resolveAgentMutationTarget = (
  effect: AgentDomMutationInstruction,
  references: AgentElementReferenceStore
): Element => {
  const ref = effect.target.ref
  if (!ref) throw new Error("Agent mutation target has no reference")
  const identity = effect.frame
  if (!references.matches(identity)) {
    throw new AgentEffectNotAppliedError("Agent mutation snapshot is stale")
  }
  const element = references.resolve(ref, identity)
  if (!element)
    throw new AgentEffectNotAppliedError("Agent mutation target is stale")
  if (!references.matchesFormState(ref, identity)) {
    throw new AgentEffectNotAppliedError(
      "Agent mutation form state changed after approval"
    )
  }
  assertUnchangedMutationTarget(effect, element)
  if (effect.target.sensitive || effect.target.formHasSensitiveControl) {
    throw new Error("Agent cannot mutate a sensitive control")
  }
  return element
}

/**
 * The live destination of a drag, or a typed refusal. Checked like the source
 * — same snapshot, same element, same observed facts — because a drop is an
 * effect on the destination, and a destination that changed since approval is
 * a drop nobody approved.
 */
export const resolveAgentDropTarget = (
  effect: AgentDomMutationInstruction,
  references: AgentElementReferenceStore
): Element => {
  const drop = effect.target.drop
  if (!drop) throw new Error("Agent drag has no drop target")
  const element = references.resolve(drop.ref, effect.frame)
  if (!element?.isConnected) {
    throw new AgentEffectNotAppliedError("Agent drop target is stale")
  }
  const current = buildAgentElementObservation(
    element,
    drop.ref,
    effect.frame.frameId
  )
  const unchanged =
    current.visible &&
    current.tag === drop.tag &&
    sameOptional(current.role, drop.role) &&
    sameOptional(current.name, drop.accessibleName) &&
    (drop.verificationId === undefined ||
      references.verificationIdOf(element) === drop.verificationId)
  if (!unchanged) {
    throw new AgentEffectNotAppliedError(
      "Agent drop target changed after approval"
    )
  }
  return element
}

const centreOf = (element: Element): { x: number; y: number } => {
  const rect = element.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

const pointerEventInit = (element: Element): MouseEventInit => {
  const rect = element.getBoundingClientRect()
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    view: element.ownerDocument.defaultView ?? undefined
  }
}

/**
 * The synthetic stand-ins for pointer gestures, used only where no debugger is
 * attached. A page can tell them from a real pointer; the receipt records the
 * backend so the verifier expects nothing a synthetic event cannot produce.
 */
const executeSyntheticPointer = (
  type: "double_click" | "hover",
  element: Element
): void => {
  const init = pointerEventInit(element)
  if (type === "hover") {
    element.dispatchEvent(new MouseEvent("mouseover", init))
    element.dispatchEvent(
      new MouseEvent("mouseenter", { ...init, bubbles: false })
    )
    element.dispatchEvent(new MouseEvent("mousemove", init))
    return
  }
  if (!(element instanceof HTMLElement)) {
    throw new Error("Agent double-click target is no longer supported")
  }
  element.click()
  element.click()
  element.dispatchEvent(new MouseEvent("dblclick", { ...init, detail: 2 }))
}

/**
 * A synthetic click at a named point, for the DOM backend. The point has to
 * still land on the resolved control; a page whose layout moved under the
 * approval is refused rather than clicked where the control used to be.
 */
const executeSyntheticPointClick = (
  point: { x: number; y: number },
  element: Element
): void => {
  const doc = element.ownerDocument
  const hit =
    typeof doc.elementFromPoint === "function"
      ? doc.elementFromPoint(point.x, point.y)
      : null
  if (!hit || !(element === hit || element.contains(hit))) {
    throw new AgentEffectNotAppliedError(
      "Agent visual target moved before execution"
    )
  }
  const init: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: point.x,
    clientY: point.y,
    button: 0,
    view: doc.defaultView ?? undefined
  }
  element.dispatchEvent(new MouseEvent("mousedown", init))
  element.dispatchEvent(new MouseEvent("mouseup", init))
  element.dispatchEvent(new MouseEvent("click", { ...init, detail: 1 }))
}

/** Executes a previously resolved mutation against the still-live snapshot. */
export const executeAgentDomMutationInDocument = (input: {
  effect: AgentDomMutationInstruction
  document: Document
  references: AgentElementReferenceStore
  signal: AgentCancellationSignal
}): string | undefined => {
  if (input.signal.aborted) throw new Error("Agent mutation cancelled")
  const element = resolveAgentMutationTarget(input.effect, input.references)

  switch (input.effect.command.type) {
    case "click":
    case "click_point":
      if (!(element instanceof HTMLElement)) {
        throw new Error("Agent click target is no longer supported")
      }
      if (input.effect.target.href) {
        throw new Error("Agent link activation must use guarded navigation")
      }
      if (input.effect.target.submitter) {
        return submitWithoutPageHandlers(input.effect, element)
      }
      if (input.effect.point) {
        executeSyntheticPointClick(input.effect.point, element)
      } else {
        element.click()
      }
      break
    case "type":
    case "clear_and_type":
    case "replace_text":
      executeTextMutation(input.effect, element)
      break
    case "drag": {
      const destination = resolveAgentDropTarget(input.effect, input.references)
      executeAgentSyntheticDrag({
        source: element,
        destination,
        from: centreOf(element),
        to: centreOf(destination)
      })
      break
    }
    case "select":
      executeSelectionMutation(input.effect, element)
      break
    case "check":
    case "uncheck":
      executeCheckedMutation(input.effect, element)
      break
    case "press_key":
      return executeKey(input.effect, element)
    case "double_click":
    case "hover":
      executeSyntheticPointer(input.effect.command.type, element)
      break
    default:
      throw new Error("Agent action is not a DOM mutation")
  }
}

/**
 * What the executor learns about native control before choosing a backend,
 * all read in one go so the choice and the offset it will use come from the
 * same moment. `frameOffset` is set only when the target's frame is placed.
 */
export interface AgentNativeControlFacts {
  cdpControl: boolean
  attached: boolean
  frameMapped: boolean
  frameOffset?: AgentInputPoint
  platform: AgentInputPlatform
}

export interface AgentNativeInputPreparation {
  point: AgentInputPoint
  focused: boolean
  /** Where a drag is released, for a `drag` alone. */
  dropPoint?: AgentInputPoint
}

export interface AgentCommandExecutorAdapter {
  getTab(tabId: number): Promise<{ id?: number; url?: string } | undefined>
  getFrame(
    tabId: number,
    frameId: number
  ): Promise<{ documentId?: string; url: string } | null>
  classifyAccess(url?: string): Promise<TabAccess>
  scroll(
    command: Extract<AuthorizedAgentEffect["command"], { type: "scroll" }>,
    identity: AgentSnapshotIdentity,
    frame: AgentSnapshotIdentity,
    signal: AgentCancellationSignal
  ): Promise<void>
  mutate(
    effect: AuthorizedAgentEffect,
    signal: AgentCancellationSignal
  ): Promise<string | undefined>
  /**
   * Native input, in the order the executor calls it: the facts a backend is
   * chosen on, the page-side recheck that arms the input record and yields the
   * pointer target, the debugger dispatch of a plan, and the record read back.
   * Absent means this browser has no native backend.
   */
  nativeControl?(
    effect: AuthorizedAgentEffect
  ): Promise<AgentNativeControlFacts>
  prepareNativeInput?(
    effect: AuthorizedAgentEffect,
    signal: AgentCancellationSignal
  ): Promise<AgentNativeInputPreparation>
  dispatchNativeInput?(
    effect: AuthorizedAgentEffect,
    plan: AgentNativeInputPlan,
    signal: AgentCancellationSignal
  ): Promise<{ dispatched: number }>
  settleNativeInput?(
    effect: AuthorizedAgentEffect,
    signal: AgentCancellationSignal
  ): Promise<AgentInputTrace | undefined>
  /** The root viewport's centre, where a native wheel is aimed. */
  viewportCentre?(
    effect: AuthorizedAgentEffect
  ): Promise<AgentInputPoint | undefined>
  /**
   * Whether the page asked for a file chooser since the action began. The
   * debugger holds such a chooser back; asked once after the action and
   * cleared by the asking, so it is charged to the step that caused it.
   */
  fileChooserOpened?(effect: AuthorizedAgentEffect): Promise<boolean>
  activateTab(tabId: number): Promise<void>
  goHistory(tabId: number, direction: "back" | "forward"): Promise<void>
  resolveHistoryDestination(
    tabId: number,
    direction: "back" | "forward"
  ): Promise<string | undefined>
  wait(ms: number, signal: AgentCancellationSignal): Promise<void>
  navigate(tabId: number, url: string): Promise<void>
  createTab(input: {
    url: string
    openerTabId: number
  }): Promise<{ id?: number; url?: string } | undefined>
  now(): number
}

const exactUrl = (value: string | undefined, expected: string): boolean => {
  if (!value) return false
  try {
    return new URL(value).href === new URL(expected).href
  } catch {
    return false
  }
}

const exactOrigin = (value: string | undefined, expected: string): boolean => {
  if (!value) return false
  try {
    return new URL(value).origin === expected
  } catch {
    return false
  }
}

const assertReadable = async (
  adapter: AgentCommandExecutorAdapter,
  url: string | undefined
): Promise<void> => {
  if ((await adapter.classifyAccess(url)) !== "ok") {
    throw new Error("Agent tab access changed before execution")
  }
}

const assertSource = async (
  effect: AuthorizedAgentEffect,
  adapter: AgentCommandExecutorAdapter,
  requireDocument: boolean
): Promise<void> => {
  const tab = await adapter.getTab(effect.snapshotIdentity.tabId)
  if (
    !tab ||
    !exactUrl(tab.url, effect.sourceUrl) ||
    !exactOrigin(tab.url, effect.sourceOrigin)
  ) {
    throw new Error("Agent source tab changed before execution")
  }
  await assertReadable(adapter, tab.url)
  if (!requireDocument) return
  const frame = await adapter.getFrame(
    effect.snapshotIdentity.tabId,
    effect.snapshotIdentity.frameId
  )
  if (
    !frame ||
    frame.documentId !== effect.snapshotIdentity.documentId ||
    !exactUrl(frame.url, effect.sourceUrl)
  ) {
    throw new Error("Agent source document changed before execution")
  }
  await assertTargetFrame(effect, adapter)
}

/**
 * A target in a child frame is bound to that frame's document too. The root
 * document standing still says nothing about a child that navigated since the
 * observation, and the child's own document is what the reference was taken
 * from; its origin is re-checked because an authorization for the page is not
 * one for whatever the frame now shows.
 */
const assertTargetFrame = async (
  effect: AuthorizedAgentEffect,
  adapter: AgentCommandExecutorAdapter
): Promise<void> => {
  const target = effect.target.frame
  if (!target || target.frameId === effect.snapshotIdentity.frameId) return
  const frame = await adapter.getFrame(target.tabId, target.frameId)
  if (!frame || frame.documentId !== target.documentId) {
    throw new AgentEffectNotAppliedError(
      "Agent target frame changed before execution"
    )
  }
  await assertReadable(adapter, frame.url)
}

type Executor = (
  effect: AuthorizedAgentEffect,
  adapter: AgentCommandExecutorAdapter,
  signal: AgentCancellationSignal
) => Promise<AgentExecutionReceipt>

const receipt = (
  adapter: AgentCommandExecutorAdapter,
  details: string,
  controlledTabId?: number
): AgentExecutionReceipt => ({
  executedAt: adapter.now(),
  details,
  ...(controlledTabId === undefined ? {} : { controlledTabId })
})

/**
 * Which backend an action runs on, decided before anything touches the page.
 * A browser without native control, or an adapter that does not offer it, is
 * the DOM backend by construction.
 */
const chooseBackend = async (
  effect: AuthorizedAgentEffect,
  adapter: AgentCommandExecutorAdapter
): Promise<{
  choice: AgentInputBackendChoice
  facts?: AgentNativeControlFacts
}> => {
  if (!adapter.nativeControl) {
    return {
      choice: chooseAgentInputBackend({
        effect,
        cdpControl: false,
        attached: false,
        frameMapped: false
      })
    }
  }
  const facts = await adapter.nativeControl(effect)
  return {
    facts,
    choice: chooseAgentInputBackend({
      effect,
      cdpControl: facts.cdpControl,
      attached: facts.attached,
      frameMapped: facts.frameMapped && facts.frameOffset !== undefined
    })
  }
}

/**
 * Runs an element action as native input.
 *
 * The page rechecks the target and arms its record; nothing has been sent by
 * then, so a refusal there is a clean stale-target failure. Once the first
 * step goes out the action is committed: a plan that cannot finish reports
 * how far it got and is never completed by other means, and a plan that
 * finished is followed by asking the document what it received. A document
 * that cannot answer — it navigated, typically — leaves delivery unknown and
 * the verifier reading page evidence.
 */
const executeNative = async (
  effect: AuthorizedAgentEffect,
  adapter: AgentCommandExecutorAdapter,
  facts: AgentNativeControlFacts,
  signal: AgentCancellationSignal
): Promise<AgentExecutionReceipt> => {
  if (
    !adapter.prepareNativeInput ||
    !adapter.dispatchNativeInput ||
    !adapter.settleNativeInput ||
    !facts.frameOffset
  ) {
    throw new Error("Agent native input adapter is incomplete")
  }
  const prepared = await adapter.prepareNativeInput(effect, signal)
  const plan = planAgentNativeInput({
    command: effect.command,
    point: prepared.point,
    frameOffset: facts.frameOffset,
    focused: prepared.focused,
    ...(prepared.dropPoint ? { dropPoint: prepared.dropPoint } : {}),
    platform: facts.platform
  })
  try {
    await adapter.dispatchNativeInput(effect, plan, signal)
  } catch (error) {
    /**
     * A first step the debugger refused to send never reached the page, so
     * the target is simply re-observed. Anything after that may have acted,
     * and is reported as such rather than completed on the DOM backend.
     */
    if (
      error instanceof AgentNativeInputFailedError &&
      error.dispatched === 0
    ) {
      throw new AgentEffectNotAppliedError(
        "Agent native input could not be sent"
      )
    }
    if (
      error instanceof AgentNativeInputCancelledError &&
      error.dispatched === 0
    ) {
      throw new AgentEffectNotAppliedError("Agent native input was cancelled")
    }
    throw error
  }
  let trace: AgentInputTrace | undefined
  let settled = true
  try {
    trace = await adapter.settleNativeInput(effect, signal)
  } catch {
    settled = false
  }
  return {
    ...receipt(adapter, effect.command.type),
    backend: "cdp",
    inputDelivery: settled ? assessAgentInputDelivery(plan, trace) : "unknown",
    ...(await fileChooserFlag(effect, adapter))
  }
}

/**
 * A file chooser the action opened, on either backend: a DOM click on an
 * upload button reaches the same `input.click()` a native one does, and the
 * attached debugger holds the chooser back either way.
 */
const fileChooserFlag = async (
  effect: AuthorizedAgentEffect,
  adapter: AgentCommandExecutorAdapter
): Promise<Pick<AgentExecutionReceipt, "fileChooser">> => {
  const opened = await adapter.fileChooserOpened?.(effect)
  return opened ? { fileChooser: true } : {}
}

/** The DOM backend, recorded as such so the verifier expects no native record. */
const executeSynthetic = async (
  effect: AuthorizedAgentEffect,
  adapter: AgentCommandExecutorAdapter,
  signal: AgentCancellationSignal
): Promise<AgentExecutionReceipt> => {
  const submissionUrl = await adapter.mutate(effect, signal)
  return {
    ...receipt(adapter, effect.command.type),
    backend: "dom",
    ...(submissionUrl ? { submissionUrl } : {}),
    ...(await fileChooserFlag(effect, adapter))
  }
}

/** An element action on whichever backend was chosen for it, and only that one. */
const executeElementAction = async (
  effect: AuthorizedAgentEffect,
  adapter: AgentCommandExecutorAdapter,
  signal: AgentCancellationSignal
): Promise<AgentExecutionReceipt> => {
  const { choice, facts } = await chooseBackend(effect, adapter)
  if (choice.backend === "cdp" && facts) {
    return executeNative(effect, adapter, facts, signal)
  }
  return executeSynthetic(effect, adapter, signal)
}

/** How long a native wheel is given to settle before the page is re-observed. */
const WHEEL_SETTLE_MS = 150

/**
 * A scroll without a target goes native when it can: a wheel at the viewport
 * centre scrolls whatever container sits there, which is the document on a
 * page and the application's own scroller on a page that never scrolls. A
 * referenced scroll keeps `scrollIntoView`, which names its destination.
 */
const executeScroll = async (
  effect: AuthorizedAgentEffect,
  adapter: AgentCommandExecutorAdapter,
  signal: AgentCancellationSignal
): Promise<AgentExecutionReceipt> => {
  if (effect.command.type !== "scroll") throw new Error("Invalid scroll effect")
  const native =
    !effect.command.ref && adapter.nativeControl && adapter.dispatchNativeInput
      ? await adapter.nativeControl(effect)
      : undefined
  const centre =
    native?.cdpControl && native.attached
      ? await adapter.viewportCentre?.(effect)
      : undefined
  if (centre && adapter.dispatchNativeInput) {
    const amount =
      effect.command.amount ??
      (effect.command.direction === "up" || effect.command.direction === "down"
        ? centre.y * 2 * 0.8
        : centre.x * 2 * 0.8)
    const plan = planAgentWheel({
      point: centre,
      direction: effect.command.direction,
      amount
    })
    await adapter.dispatchNativeInput(effect, plan, signal)
    await adapter.wait(WHEEL_SETTLE_MS, signal)
    return { ...receipt(adapter, "scroll"), backend: "cdp" }
  }
  await adapter.scroll(
    effect.command,
    effect.snapshotIdentity,
    effect.target.frame ?? effect.snapshotIdentity,
    signal
  )
  return { ...receipt(adapter, "scroll"), backend: "dom" }
}

export const READ_ONLY_AGENT_EXECUTORS = {
  async read(effect, adapter) {
    await assertSource(effect, adapter, true)
    return receipt(adapter, "read")
  },
  /**
   * Inspection touches nothing: its whole effect is to steer the next
   * observation, which the run rebuilds from the step's own command. The
   * executor confirms the page is still the one named and returns.
   */
  async inspect(effect, adapter) {
    await assertSource(effect, adapter, true)
    return receipt(adapter, "inspect")
  },
  async zoom(effect, adapter) {
    await assertSource(effect, adapter, true)
    return receipt(adapter, "zoom")
  },
  async find(effect, adapter) {
    await assertSource(effect, adapter, true)
    return receipt(adapter, "find")
  },
  async extract_text(effect, adapter) {
    await assertSource(effect, adapter, true)
    return receipt(adapter, "extract_text")
  },
  async wait(effect, adapter, signal) {
    await assertSource(effect, adapter, true)
    if (effect.command.type !== "wait") throw new Error("Invalid wait effect")
    await adapter.wait(effect.command.timeoutMs, signal)
    return receipt(adapter, "wait")
  },
  async scroll(effect, adapter, signal) {
    await assertSource(effect, adapter, true)
    return executeScroll(effect, adapter, signal)
  },
  async switch_tab(effect, adapter) {
    if (effect.command.type !== "switch_tab" || !effect.destination) {
      throw new Error("Invalid switch-tab effect")
    }
    await assertSource(effect, adapter, false)
    const target = await adapter.getTab(effect.command.tabId)
    if (!target || !exactUrl(target.url, effect.destination.url)) {
      throw new Error("Agent switch-tab destination changed")
    }
    await assertReadable(adapter, target.url)
    await adapter.activateTab(effect.command.tabId)
    return receipt(adapter, "switch_tab", effect.command.tabId)
  },
  async back(effect, adapter) {
    await assertSource(effect, adapter, false)
    if (!effect.destination) throw new Error("Unknown back destination")
    const destination = await adapter.resolveHistoryDestination(
      effect.snapshotIdentity.tabId,
      "back"
    )
    if (!exactUrl(destination, effect.destination.url)) {
      throw new Error("Agent back destination changed")
    }
    await assertReadable(adapter, destination)
    await adapter.goHistory(effect.snapshotIdentity.tabId, "back")
    return receipt(adapter, "back")
  },
  async forward(effect, adapter) {
    await assertSource(effect, adapter, false)
    if (!effect.destination) throw new Error("Unknown forward destination")
    const destination = await adapter.resolveHistoryDestination(
      effect.snapshotIdentity.tabId,
      "forward"
    )
    if (!exactUrl(destination, effect.destination.url)) {
      throw new Error("Agent forward destination changed")
    }
    await assertReadable(adapter, destination)
    await adapter.goHistory(effect.snapshotIdentity.tabId, "forward")
    return receipt(adapter, "forward")
  }
} satisfies Record<ReadOnlyAgentAction, Executor>

export const executeReadOnlyAgentEffect = async (input: {
  effect: AuthorizedAgentEffect
  adapter: AgentCommandExecutorAdapter
  signal: AgentCancellationSignal
}): Promise<AgentExecutionReceipt> => {
  const executor = READ_ONLY_AGENT_EXECUTORS[
    input.effect.command.type as ReadOnlyAgentAction
  ] as Executor | undefined
  if (!executor) throw new Error("Agent action has no read-only executor")
  return executor(input.effect, input.adapter, input.signal)
}

export const NAVIGATION_AGENT_EXECUTORS = {
  async navigate(effect, adapter) {
    if (effect.command.type !== "navigate" || !effect.destination) {
      throw new Error("Invalid navigate effect")
    }
    /**
     * The authorization the user gave names one source page and one
     * destination. Re-establishing the source here is what keeps an approval
     * from being spent on a page that changed underneath it while the run
     * waited, and the destination is taken from the resolved effect rather
     * than from the command so an approved URL is the URL that travels.
     */
    await assertSource(effect, adapter, true)
    await assertReadable(adapter, effect.destination.url)
    await adapter.navigate(
      effect.snapshotIdentity.tabId,
      effect.destination.url
    )
    return receipt(adapter, "navigate")
  },
  async open_tab(effect, adapter) {
    if (effect.command.type !== "open_tab" || !effect.destination) {
      throw new Error("Invalid open-tab effect")
    }
    await assertSource(effect, adapter, true)
    await assertReadable(adapter, effect.destination.url)
    const opened = await adapter.createTab({
      url: effect.destination.url,
      openerTabId: effect.snapshotIdentity.tabId
    })
    if (opened?.id === undefined) {
      throw new Error("Agent open-tab produced no tab")
    }
    /**
     * The new tab is reported, not adopted: the controller moves the run onto
     * it only after verification confirms the destination it actually holds.
     */
    return receipt(adapter, "open_tab", opened.id)
  }
} satisfies Record<NavigationAgentAction, Executor>

export const executeNavigationAgentEffect = async (input: {
  effect: AuthorizedAgentEffect
  adapter: AgentCommandExecutorAdapter
  signal: AgentCancellationSignal
}): Promise<AgentExecutionReceipt> => {
  const executor = NAVIGATION_AGENT_EXECUTORS[
    input.effect.command.type as NavigationAgentAction
  ] as Executor | undefined
  if (!executor) throw new Error("Agent action has no navigation executor")
  return executor(input.effect, input.adapter, input.signal)
}

const executeClick: Executor = async (effect, adapter, signal) => {
  await assertSource(effect, adapter, true)
  if (effect.destination) {
    await assertReadable(adapter, effect.destination.url)
  }
  if (
    effect.destination &&
    effect.semanticEffects.includes("navigation") &&
    !effect.semanticEffects.includes("submission")
  ) {
    await adapter.navigate(
      effect.snapshotIdentity.tabId,
      effect.destination.url
    )
    return { ...receipt(adapter, effect.command.type), backend: "dom" }
  }
  return executeElementAction(effect, adapter, signal)
}

export const DOM_MUTATION_AGENT_EXECUTORS = {
  click: executeClick,
  /** A visual click is a click on the control found under the point. */
  click_point: executeClick,
  async double_click(effect, adapter, signal) {
    await assertSource(effect, adapter, true)
    return executeElementAction(effect, adapter, signal)
  },
  async hover(effect, adapter, signal) {
    await assertSource(effect, adapter, true)
    return executeElementAction(effect, adapter, signal)
  },
  async type(effect, adapter, signal) {
    await assertSource(effect, adapter, true)
    return executeElementAction(effect, adapter, signal)
  },
  async clear_and_type(effect, adapter, signal) {
    await assertSource(effect, adapter, true)
    return executeElementAction(effect, adapter, signal)
  },
  async replace_text(effect, adapter, signal) {
    await assertSource(effect, adapter, true)
    return executeElementAction(effect, adapter, signal)
  },
  async drag(effect, adapter, signal) {
    await assertSource(effect, adapter, true)
    return executeElementAction(effect, adapter, signal)
  },
  async select(effect, adapter, signal) {
    await assertSource(effect, adapter, true)
    await adapter.mutate(effect, signal)
    return receipt(adapter, "select")
  },
  async check(effect, adapter, signal) {
    await assertSource(effect, adapter, true)
    await adapter.mutate(effect, signal)
    return receipt(adapter, "check")
  },
  async uncheck(effect, adapter, signal) {
    await assertSource(effect, adapter, true)
    await adapter.mutate(effect, signal)
    return receipt(adapter, "uncheck")
  },
  async press_key(effect, adapter, signal) {
    await assertSource(effect, adapter, true)
    if (effect.destination) {
      await assertReadable(adapter, effect.destination.url)
    }
    return executeElementAction(effect, adapter, signal)
  }
} satisfies Record<DomMutationAgentAction, Executor>

export const executeDomMutationAgentEffect = async (input: {
  effect: AuthorizedAgentEffect
  adapter: AgentCommandExecutorAdapter
  signal: AgentCancellationSignal
}): Promise<AgentExecutionReceipt> => {
  const executor = DOM_MUTATION_AGENT_EXECUTORS[
    input.effect.command.type as DomMutationAgentAction
  ] as Executor | undefined
  if (!executor) throw new Error("Agent action has no DOM mutation executor")
  return executor(input.effect, input.adapter, input.signal)
}
