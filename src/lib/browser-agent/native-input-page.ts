import { AgentEffectNotAppliedError } from "@ollama-client/agent-runtime"

import { resolveAgentMutationTarget } from "./command-executor"
import type { AgentDomMutationInstruction } from "./control-port"
import type { AgentElementReferenceStore } from "./element-references"
import type {
  AgentInputPoint,
  AgentInputTrace,
  AgentRecordedInputEvent,
  AgentRecordedInputEventType
} from "./native-input"
import { findAgentReachablePoint } from "./observation-builder"

/**
 * The page's half of native input: the recheck a pointer needs immediately
 * before it is sent, and the record of what the document then received.
 *
 * Coordinates never leave this frame's own viewport. The background adds the
 * frame's offset in the root viewport itself, from the debugger's frame tree,
 * so a child document cannot steer a click by misreporting where it sits.
 */

export interface AgentNativeInputPreparation {
  /** Where to send the pointer, in this frame's viewport CSS pixels. */
  point: AgentInputPoint
  /** Whether the target already holds focus. */
  focused: boolean
}

const RECORDED_EVENT_TYPES: readonly AgentRecordedInputEventType[] = [
  "mousemove",
  "mousedown",
  "mouseup",
  "keydown",
  "keyup",
  "wheel"
]

const isRecordedType = (type: string): type is AgentRecordedInputEventType =>
  (RECORDED_EVENT_TYPES as readonly string[]).includes(type)

/**
 * Enough for the longest plan — five hundred characters typed is a thousand
 * key events plus a click — with room for the events a page produces around
 * them. Past the cap the record is marked as overflowed, not truncated
 * silently, so an unbounded page cannot hide interference behind the cap.
 */
export const MAX_AGENT_RECORDED_INPUT_EVENTS = 2_200

const composedTargetOf = (event: Event): Element | undefined => {
  const path =
    typeof event.composedPath === "function" ? event.composedPath() : []
  const candidate = path[0] ?? event.target
  return candidate && typeof candidate === "object" && "nodeType" in candidate
    ? (candidate as Node).nodeType === 1
      ? (candidate as Element)
      : ((candidate as Node).parentElement ?? undefined)
    : undefined
}

const composedParent = (element: Element): Element | null => {
  if (element.parentElement) return element.parentElement
  const root = element.getRootNode()
  return root && "host" in root ? ((root as ShadowRoot).host ?? null) : null
}

const withinTarget = (target: Element, candidate: Element | undefined) => {
  for (
    let node: Element | null = candidate ?? null;
    node;
    node = composedParent(node)
  ) {
    if (node === target) return true
  }
  return false
}

const recordOf = (
  event: Event,
  target: Element,
  trusted: (event: Event) => boolean
): AgentRecordedInputEvent | undefined => {
  if (!trusted(event) || !isRecordedType(event.type)) return undefined
  const onTarget = withinTarget(target, composedTargetOf(event))
  if (event instanceof KeyboardEvent) {
    return { type: event.type, key: event.key, onTarget }
  }
  if (event instanceof MouseEvent) {
    return { type: event.type, x: event.clientX, y: event.clientY, onTarget }
  }
  return undefined
}

export interface AgentInputWatch {
  /** Starts recording trusted input against `target`; replaces any earlier watch. */
  arm(target: Element): void
  /** Stops recording and returns what was seen since `arm`. */
  settle(): AgentInputTrace | undefined
}

/**
 * Records the trusted input events a document receives while a plan is in
 * flight. Native events from the debugger and events from a physical mouse
 * are both trusted, so the record itself cannot tell them apart; the
 * background matches it against the plan, and whatever the plan did not send
 * was the user.
 */
export const createAgentInputWatch = (
  document: Document,
  options?: {
    /** Overridable so a test runtime, whose dispatched events are never trusted, can drive the record. */
    trusted?: (event: Event) => boolean
  }
): AgentInputWatch => {
  const trusted = options?.trusted ?? ((event: Event) => event.isTrusted)
  let active:
    | { events: AgentRecordedInputEvent[]; overflow: boolean; stop(): void }
    | undefined

  return {
    arm(target) {
      active?.stop()
      const view = document.defaultView
      const events: AgentRecordedInputEvent[] = []
      const state = { events, overflow: false, stop: () => undefined }
      const listener = (event: Event) => {
        if (events.length >= MAX_AGENT_RECORDED_INPUT_EVENTS) {
          state.overflow = true
          return
        }
        const record = recordOf(event, target, trusted)
        if (record) events.push(record)
      }
      const scope: EventTarget = view ?? document
      for (const type of RECORDED_EVENT_TYPES) {
        scope.addEventListener(type, listener, { capture: true, passive: true })
      }
      state.stop = () => {
        for (const type of RECORDED_EVENT_TYPES) {
          scope.removeEventListener(type, listener, { capture: true })
        }
      }
      active = state
    },
    settle() {
      if (!active) return undefined
      const { events, overflow, stop } = active
      stop()
      active = undefined
      return { events, ...(overflow ? { overflow: true } : {}) }
    }
  }
}

const fullyInViewport = (element: Element): boolean => {
  const view = element.ownerDocument.defaultView
  if (!view) return true
  const rect = element.getBoundingClientRect()
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= view.innerHeight &&
    rect.right <= view.innerWidth
  )
}

/**
 * Rechecks the approved target and picks the point a native pointer goes to.
 *
 * The same guards as synthetic execution run first, so a target that changed
 * since approval is refused before anything is aimed at it. The element is
 * brought into view if it is not, its reachable point is taken from the same
 * hit test that reported occlusion, and the watch is armed against it — all
 * in one synchronous pass, so nothing the page does between these steps can
 * move the point away from the element that was checked.
 */
export const prepareAgentNativeInputInDocument = (input: {
  effect: AgentDomMutationInstruction
  references: AgentElementReferenceStore
  watch: AgentInputWatch
}): AgentNativeInputPreparation => {
  const element = resolveAgentMutationTarget(input.effect, input.references)
  /**
   * A named point is used as named, never re-sampled: the run approved a
   * click there. It has to still land on the control, though — scrolling is
   * skipped so the point stays meaningful, and a layout that moved the control
   * away from it is a stale target, not a target to chase.
   */
  if (input.effect.point) {
    const doc = element.ownerDocument
    const hit =
      typeof doc.elementFromPoint === "function"
        ? doc.elementFromPoint(input.effect.point.x, input.effect.point.y)
        : null
    if (!hit || !(hit === element || element.contains(hit))) {
      throw new AgentEffectNotAppliedError(
        "Agent visual target moved before execution"
      )
    }
    input.watch.arm(element)
    return {
      point: input.effect.point,
      focused: element === doc.activeElement
    }
  }
  if (!fullyInViewport(element)) {
    element.scrollIntoView({
      block: "center",
      inline: "center",
      behavior: "instant"
    })
  }
  const point = findAgentReachablePoint(element)
  if (!point) {
    throw new AgentEffectNotAppliedError(
      "Agent target is covered by another element"
    )
  }
  input.watch.arm(element)
  return {
    point,
    focused: element === element.ownerDocument.activeElement
  }
}
