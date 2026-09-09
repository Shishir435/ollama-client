import type {
  AgentCancellationSignal,
  AgentInputBackend,
  AgentInputDelivery,
  AuthorizedAgentEffect
} from "@ollama-client/agent-runtime"
import {
  type AgentCommand,
  type AgentKeyModifier,
  parseAgentKeyCombination
} from "@ollama-client/contracts"

/**
 * Native input planning, delivery and accounting, with no browser in it.
 *
 * A plan is the exact sequence of pointer and keyboard events an action needs;
 * the runner sends them one at a time through a dispatcher and owes the page a
 * release for everything it pressed, however the sequence ends. What the page
 * then reports having received is matched back against the plan, so the run
 * can tell its own input from a user's hand on the same mouse.
 */

/** Actions that run as native input when a debugger is attached. */
export const NATIVE_INPUT_AGENT_ACTIONS = [
  "click",
  "double_click",
  "hover",
  "type",
  "clear_and_type",
  "press_key"
] as const
export type NativeInputAgentAction = (typeof NATIVE_INPUT_AGENT_ACTIONS)[number]

export interface AgentInputPoint {
  x: number
  y: number
}

export type AgentInputPlatform = "mac" | "other"

/** CDP `Input` modifier bits. */
const MODIFIER_BITS: Record<AgentKeyModifier, number> = {
  Alt: 1,
  Control: 2,
  Meta: 4,
  Shift: 8
}

export interface AgentNativeKeyDefinition {
  key: string
  code?: string
  keyCode?: number
  /** Present for a key that inserts text; absent for a control key. */
  text?: string
  location?: number
}

const NAMED_KEY_DEFINITIONS: Record<string, AgentNativeKeyDefinition> = {
  Enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  Delete: { key: "Delete", code: "Delete", keyCode: 46 },
  Space: { key: " ", code: "Space", keyCode: 32, text: " " },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  Home: { key: "Home", code: "Home", keyCode: 36 },
  End: { key: "End", code: "End", keyCode: 35 },
  PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  Control: { key: "Control", code: "ControlLeft", keyCode: 17, location: 1 },
  Shift: { key: "Shift", code: "ShiftLeft", keyCode: 16, location: 1 },
  Alt: { key: "Alt", code: "AltLeft", keyCode: 18, location: 1 },
  Meta: { key: "Meta", code: "MetaLeft", keyCode: 91, location: 1 }
}

/** US-layout punctuation: the character, its `code`, and its virtual key. */
const PUNCTUATION_DEFINITIONS: Record<string, [code: string, keyCode: number]> =
  {
    "`": ["Backquote", 192],
    "~": ["Backquote", 192],
    "-": ["Minus", 189],
    _: ["Minus", 189],
    "=": ["Equal", 187],
    "+": ["Equal", 187],
    "[": ["BracketLeft", 219],
    "{": ["BracketLeft", 219],
    "]": ["BracketRight", 221],
    "}": ["BracketRight", 221],
    "\\": ["Backslash", 220],
    "|": ["Backslash", 220],
    ";": ["Semicolon", 186],
    ":": ["Semicolon", 186],
    "'": ["Quote", 222],
    '"': ["Quote", 222],
    ",": ["Comma", 188],
    "<": ["Comma", 188],
    ".": ["Period", 190],
    ">": ["Period", 190],
    "/": ["Slash", 191],
    "?": ["Slash", 191],
    "!": ["Digit1", 49],
    "@": ["Digit2", 50],
    "#": ["Digit3", 51],
    $: ["Digit4", 52],
    "%": ["Digit5", 53],
    "^": ["Digit6", 54],
    "&": ["Digit7", 55],
    "*": ["Digit8", 56],
    "(": ["Digit9", 57],
    ")": ["Digit0", 48]
  }

/**
 * The native definition of one character, or nothing for a character the
 * table has no key for — those are inserted as text rather than typed, since a
 * key event with an invented code is a synthetic event by another name.
 */
export const agentNativeKeyDefinition = (
  key: string
): AgentNativeKeyDefinition | undefined => {
  const named = NAMED_KEY_DEFINITIONS[key]
  if (named) return named
  if ([...key].length !== 1) return undefined
  if (/^[a-z]$/i.test(key)) {
    return {
      key,
      code: `Key${key.toUpperCase()}`,
      keyCode: key.toUpperCase().charCodeAt(0),
      text: key
    }
  }
  if (/^[0-9]$/.test(key)) {
    return { key, code: `Digit${key}`, keyCode: key.charCodeAt(0), text: key }
  }
  if (key === " ") return NAMED_KEY_DEFINITIONS.Space
  const punctuation = PUNCTUATION_DEFINITIONS[key]
  if (punctuation) {
    return { key, code: punctuation[0], keyCode: punctuation[1], text: key }
  }
  return undefined
}

export type AgentNativeInputStep =
  | {
      kind: "mouse"
      type: "mouseMoved" | "mousePressed" | "mouseReleased"
      x: number
      y: number
      button: "none" | "left"
      clickCount: number
      modifiers: number
    }
  | {
      kind: "key"
      type: "keyDown" | "keyUp"
      key: string
      code?: string
      keyCode?: number
      text?: string
      location?: number
      modifiers: number
      /** Editing commands the key carries, e.g. `selectAll`. */
      commands?: readonly string[]
    }
  | { kind: "insertText"; text: string }
  | {
      kind: "wheel"
      x: number
      y: number
      deltaX: number
      deltaY: number
    }

/**
 * One DOM event the page is expected to report if the plan arrived. Pointer
 * coordinates are in the target frame's own viewport; keys carry their `key`.
 */
export interface AgentExpectedInputEvent {
  type: "mousemove" | "mousedown" | "mouseup" | "keydown" | "keyup" | "wheel"
  x?: number
  y?: number
  key?: string
}

export interface AgentNativeInputPlan {
  steps: readonly AgentNativeInputStep[]
  expected: readonly AgentExpectedInputEvent[]
}

const modifierMask = (modifiers: readonly AgentKeyModifier[]): number =>
  modifiers.reduce((mask, modifier) => mask | MODIFIER_BITS[modifier], 0)

const primaryModifier = (platform: AgentInputPlatform): AgentKeyModifier =>
  platform === "mac" ? "Meta" : "Control"

interface PlanBuilder {
  steps: AgentNativeInputStep[]
  expected: AgentExpectedInputEvent[]
}

const pushMouse = (
  builder: PlanBuilder,
  type: "mouseMoved" | "mousePressed" | "mouseReleased",
  root: AgentInputPoint,
  local: AgentInputPoint,
  clickCount: number
): void => {
  builder.steps.push({
    kind: "mouse",
    type,
    x: root.x,
    y: root.y,
    button: type === "mouseMoved" ? "none" : "left",
    clickCount,
    modifiers: 0
  })
  builder.expected.push({
    type:
      type === "mouseMoved"
        ? "mousemove"
        : type === "mousePressed"
          ? "mousedown"
          : "mouseup",
    x: local.x,
    y: local.y
  })
}

const pushKey = (
  builder: PlanBuilder,
  type: "keyDown" | "keyUp",
  definition: AgentNativeKeyDefinition,
  modifiers: number,
  commands?: readonly string[]
): void => {
  builder.steps.push({
    kind: "key",
    type,
    key: definition.key,
    ...(definition.code ? { code: definition.code } : {}),
    ...(definition.keyCode !== undefined
      ? { keyCode: definition.keyCode }
      : {}),
    ...(type === "keyDown" && definition.text ? { text: definition.text } : {}),
    ...(definition.location !== undefined
      ? { location: definition.location }
      : {}),
    modifiers,
    ...(commands && type === "keyDown" ? { commands } : {})
  })
  builder.expected.push({
    type: type === "keyDown" ? "keydown" : "keyup",
    key: definition.key
  })
}

/** Presses a key with modifiers held around it, releasing in reverse order. */
const pushCombination = (
  builder: PlanBuilder,
  modifiers: readonly AgentKeyModifier[],
  definition: AgentNativeKeyDefinition,
  commands?: readonly string[]
): void => {
  let mask = 0
  for (const modifier of modifiers) {
    pushKey(builder, "keyDown", NAMED_KEY_DEFINITIONS[modifier], mask)
    mask |= MODIFIER_BITS[modifier]
  }
  pushKey(builder, "keyDown", definition, mask, commands)
  pushKey(builder, "keyUp", definition, mask)
  for (const modifier of [...modifiers].reverse()) {
    mask &= ~MODIFIER_BITS[modifier]
    pushKey(builder, "keyUp", NAMED_KEY_DEFINITIONS[modifier], mask)
  }
}

const pushText = (builder: PlanBuilder, text: string): void => {
  let pending = ""
  const flush = () => {
    if (pending) builder.steps.push({ kind: "insertText", text: pending })
    pending = ""
  }
  for (const character of text) {
    if (character === "\n" || character === "\r") {
      flush()
      pushCombination(builder, [], NAMED_KEY_DEFINITIONS.Enter)
      continue
    }
    const definition = agentNativeKeyDefinition(character)
    if (!definition || !definition.text) {
      pending += character
      continue
    }
    flush()
    pushKey(builder, "keyDown", definition, 0)
    pushKey(builder, "keyUp", definition, 0)
  }
  flush()
}

const clickAt = (
  builder: PlanBuilder,
  root: AgentInputPoint,
  local: AgentInputPoint,
  clicks: number
): void => {
  pushMouse(builder, "mouseMoved", root, local, 0)
  for (let count = 1; count <= clicks; count += 1) {
    pushMouse(builder, "mousePressed", root, local, count)
    pushMouse(builder, "mouseReleased", root, local, count)
  }
}

export interface AgentNativeInputPlanInput {
  command: AgentCommand
  /** The target's chosen point in its own frame's viewport. */
  point: AgentInputPoint
  /** Where that frame's viewport origin sits in the root viewport. */
  frameOffset: AgentInputPoint
  /** Whether the target already holds focus, so typing needs no click first. */
  focused: boolean
  platform: AgentInputPlatform
}

/**
 * The full native sequence for one command. Text entry focuses the control
 * with a real click when it is not focused already — that is what a user
 * does, and it is what a controlled input listens for — then moves the caret
 * to the end (`type`) or selects everything and deletes it (`clear_and_type`)
 * through editing commands, which do the same thing on every platform.
 */
export const planAgentNativeInput = (
  input: AgentNativeInputPlanInput
): AgentNativeInputPlan => {
  const builder: PlanBuilder = { steps: [], expected: [] }
  const root = {
    x: input.point.x + input.frameOffset.x,
    y: input.point.y + input.frameOffset.y
  }
  const primary = primaryModifier(input.platform)
  switch (input.command.type) {
    case "click":
      clickAt(builder, root, input.point, 1)
      break
    case "double_click":
      clickAt(builder, root, input.point, 2)
      break
    case "hover":
      pushMouse(builder, "mouseMoved", root, input.point, 0)
      break
    case "type":
    case "clear_and_type": {
      if (!input.focused) clickAt(builder, root, input.point, 1)
      if (input.command.type === "clear_and_type") {
        pushCombination(
          builder,
          [primary],
          agentNativeKeyDefinition("a") as AgentNativeKeyDefinition,
          ["selectAll"]
        )
        pushCombination(builder, [], NAMED_KEY_DEFINITIONS.Backspace)
      } else {
        pushCombination(builder, [], NAMED_KEY_DEFINITIONS.End, [
          "moveToEndOfDocument"
        ])
      }
      pushText(builder, input.command.text)
      break
    }
    case "press_key": {
      const combination = parseAgentKeyCombination(input.command.key)
      if (!combination) throw new Error("Agent key combination is invalid")
      const definition = agentNativeKeyDefinition(combination.key)
      if (!definition) throw new Error("Agent key has no native definition")
      const withModifiers = {
        ...definition,
        ...(combination.modifiers.length > 0 ? { text: undefined } : {})
      }
      const isSelectAll =
        combination.key.toLowerCase() === "a" &&
        combination.modifiers.length === 1 &&
        (combination.modifiers[0] === "Control" ||
          combination.modifiers[0] === "Meta")
      pushCombination(
        builder,
        isSelectAll ? [primary] : combination.modifiers,
        withModifiers,
        isSelectAll ? ["selectAll"] : undefined
      )
      break
    }
    default:
      throw new Error(
        `Agent action has no native input plan: ${input.command.type}`
      )
  }
  return builder
}

export const planAgentWheel = (input: {
  point: AgentInputPoint
  direction: "up" | "down" | "left" | "right"
  amount: number
}): AgentNativeInputPlan => ({
  steps: [
    {
      kind: "wheel",
      x: input.point.x,
      y: input.point.y,
      deltaX:
        input.direction === "left"
          ? -input.amount
          : input.direction === "right"
            ? input.amount
            : 0,
      deltaY:
        input.direction === "up"
          ? -input.amount
          : input.direction === "down"
            ? input.amount
            : 0
    }
  ],
  expected: [{ type: "wheel", x: input.point.x, y: input.point.y }]
})

export interface AgentNativeInputDispatcher {
  dispatch(step: AgentNativeInputStep): Promise<void>
}

/** The run stopped while input was in flight; every held key and button was released first. */
export class AgentNativeInputCancelledError extends Error {
  constructor(readonly dispatched: number) {
    super("Agent native input cancelled")
    this.name = "AgentNativeInputCancelledError"
  }
}

/** A step could not be sent; whatever was held was released, best effort. */
export class AgentNativeInputFailedError extends Error {
  constructor(
    readonly dispatched: number,
    override readonly cause: unknown
  ) {
    super("Agent native input failed mid-sequence")
    this.name = "AgentNativeInputFailedError"
  }
}

interface HeldInput {
  button?: { x: number; y: number; clickCount: number }
  keys: Map<string, Extract<AgentNativeInputStep, { kind: "key" }>>
}

const releaseSteps = (held: HeldInput): AgentNativeInputStep[] => {
  const steps: AgentNativeInputStep[] = []
  if (held.button) {
    steps.push({
      kind: "mouse",
      type: "mouseReleased",
      x: held.button.x,
      y: held.button.y,
      button: "left",
      clickCount: held.button.clickCount,
      modifiers: 0
    })
  }
  for (const key of [...held.keys.values()].reverse()) {
    steps.push({
      kind: "key",
      type: "keyUp",
      key: key.key,
      ...(key.code ? { code: key.code } : {}),
      ...(key.keyCode !== undefined ? { keyCode: key.keyCode } : {}),
      ...(key.location !== undefined ? { location: key.location } : {}),
      modifiers: 0
    })
  }
  return steps
}

const track = (held: HeldInput, step: AgentNativeInputStep): void => {
  if (step.kind === "mouse") {
    if (step.type === "mousePressed") {
      held.button = { x: step.x, y: step.y, clickCount: step.clickCount }
    } else if (step.type === "mouseReleased") {
      held.button = undefined
    }
    return
  }
  if (step.kind === "key") {
    if (step.type === "keyDown") held.keys.set(step.key, step)
    else held.keys.delete(step.key)
  }
}

/**
 * Sends a plan one step at a time.
 *
 * Cancellation is honoured between steps, never by dropping the sequence
 * where it stands: a pressed button or a held modifier is released before the
 * runner throws, so a stopped run leaves the page with nothing held down. A
 * step the dispatcher could not send is treated the same way. Neither path
 * re-sends anything — the count of steps that went out is what the caller
 * learns, and it is enough to know that the page may have acted.
 */
export const runAgentNativeInputPlan = async (
  plan: AgentNativeInputPlan,
  dispatcher: AgentNativeInputDispatcher,
  signal: AgentCancellationSignal
): Promise<{ dispatched: number }> => {
  const held: HeldInput = { keys: new Map() }
  let dispatched = 0
  const release = async () => {
    for (const step of releaseSteps(held)) {
      try {
        await dispatcher.dispatch(step)
      } catch {
        /* Releasing is best effort; the failure that got us here is reported. */
      }
    }
  }
  for (const step of plan.steps) {
    if (signal.aborted) {
      await release()
      throw new AgentNativeInputCancelledError(dispatched)
    }
    try {
      await dispatcher.dispatch(step)
    } catch (error) {
      await release()
      throw new AgentNativeInputFailedError(dispatched, error)
    }
    dispatched += 1
    track(held, step)
  }
  return { dispatched }
}

export type AgentRecordedInputEventType = AgentExpectedInputEvent["type"]

/** One trusted input event the page recorded while a plan was in flight. */
export interface AgentRecordedInputEvent {
  type: AgentRecordedInputEventType
  x?: number
  y?: number
  key?: string
  /** Whether the event's composed target was the resolved element or inside it. */
  onTarget: boolean
}

export interface AgentInputTrace {
  events: readonly AgentRecordedInputEvent[]
  /** The record hit its cap; what came after it is unknown. */
  overflow?: boolean
}

/** Events that change state when a hand produces them; a stray mousemove does not. */
const INTERFERENCE_TYPES = new Set([
  "mousedown",
  "mouseup",
  "keydown",
  "keyup",
  "wheel"
])

const POINTER_TOLERANCE_PX = 1.5

const matchesExpected = (
  expected: AgentExpectedInputEvent,
  recorded: AgentRecordedInputEvent
): boolean => {
  if (expected.type !== recorded.type) return false
  if (expected.key !== undefined) return expected.key === recorded.key
  if (expected.x === undefined || expected.y === undefined) return true
  return (
    recorded.x !== undefined &&
    recorded.y !== undefined &&
    Math.abs(recorded.x - expected.x) <= POINTER_TOLERANCE_PX &&
    Math.abs(recorded.y - expected.y) <= POINTER_TOLERANCE_PX
  )
}

/**
 * Reads the page's record against the plan.
 *
 * Every event the plan sent is looked for in order; an event of a
 * state-changing type that the plan did not send is interference, whatever
 * else matched, because the page's next state is then the product of two
 * hands. Only when nothing foreign arrived does the count of matched events
 * decide between delivered, partial and undelivered, and only a fully
 * delivered plan is asked whether it landed on the resolved target.
 */
export const assessAgentInputDelivery = (
  plan: AgentNativeInputPlan,
  trace: AgentInputTrace | undefined
): AgentInputDelivery => {
  if (!trace || trace.overflow) return "unknown"
  let next = 0
  let interference = false
  const matched: AgentRecordedInputEvent[] = []
  for (const recorded of trace.events) {
    const expected = plan.expected[next]
    if (expected && matchesExpected(expected, recorded)) {
      matched.push(recorded)
      next += 1
      continue
    }
    if (INTERFERENCE_TYPES.has(recorded.type)) interference = true
  }
  if (interference) return "interference"
  if (plan.expected.length === 0) return "delivered"
  if (matched.length === 0) return "undelivered"
  if (matched.length < plan.expected.length) return "partial"
  return matched.every((event) => event.onTarget) ? "delivered" : "misdirected"
}

export interface AgentInputBackendChoice {
  backend: AgentInputBackend
  reason:
    | "native"
    | "guarded_navigation"
    | "guarded_submission"
    | "action_not_native"
    | "no_native_control"
    | "frame_unmapped"
}

/**
 * Decides, before anything is sent, which backend an action runs on.
 *
 * Link activation and form submission keep the guarded DOM paths whatever is
 * attached: those paths exist so page handlers cannot redirect an approved
 * destination, and a native click would hand that destination back to the
 * page. Everything else that has a native plan goes native when the run
 * holds the debugger for this tab and the target's frame is one the debugger
 * can place. The choice is final for the action.
 */
export const chooseAgentInputBackend = (input: {
  effect: Pick<AuthorizedAgentEffect, "command" | "target">
  cdpControl: boolean
  attached: boolean
  frameMapped: boolean
}): AgentInputBackendChoice => {
  const { command, target } = input.effect
  if (
    !(NATIVE_INPUT_AGENT_ACTIONS as readonly string[]).includes(command.type)
  ) {
    return { backend: "dom", reason: "action_not_native" }
  }
  if (command.type === "click" && target.href) {
    return { backend: "dom", reason: "guarded_navigation" }
  }
  if (command.type === "click" && target.submitter) {
    return { backend: "dom", reason: "guarded_submission" }
  }
  if (
    command.type === "press_key" &&
    command.key === "Enter" &&
    target.maySubmit
  ) {
    return { backend: "dom", reason: "guarded_submission" }
  }
  if (!input.cdpControl || !input.attached) {
    return { backend: "dom", reason: "no_native_control" }
  }
  if (!input.frameMapped) return { backend: "dom", reason: "frame_unmapped" }
  return { backend: "cdp", reason: "native" }
}
