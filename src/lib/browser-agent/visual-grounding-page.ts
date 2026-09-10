import type {
  AgentElement,
  AgentSnapshotIdentity
} from "@ollama-client/contracts"

import type { AgentElementRectWire, AgentHitTestResult } from "./control-port"
import type { AgentElementReferenceStore } from "./element-references"
import { buildAgentElementObservation } from "./observation-builder"

/**
 * The page's answers for visual grounding: where its observed controls are,
 * and what lies under a point. Both are read-only and both are bound to the
 * live snapshot — a ref from an earlier generation resolves to nothing, and a
 * point is answered against the document as it stands now.
 */

const composedParent = (element: Element): Element | null => {
  if (element.parentElement) return element.parentElement
  const root = element.getRootNode()
  return root && "host" in root ? ((root as ShadowRoot).host ?? null) : null
}

/** Client rects of the refs that still resolve, in this frame's viewport CSS pixels. */
export const measureAgentElementsInDocument = (input: {
  identity: AgentSnapshotIdentity
  refs: readonly string[]
  references: AgentElementReferenceStore
}): AgentElementRectWire[] => {
  if (!input.references.matches(input.identity)) return []
  const rects: AgentElementRectWire[] = []
  for (const ref of input.refs) {
    const element = input.references.resolve(ref, input.identity)
    if (!element) continue
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    rects.push({
      ref,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height
    })
  }
  return rects
}

const isFrameElement = (element: Element): boolean =>
  element.tagName === "IFRAME" || element.tagName === "FRAME"

/**
 * What a pointer at `point` would land on, in terms the run already uses.
 *
 * The hit element's composed ancestry is walked for a control the snapshot
 * listed, because a click on a button's icon is a click on the button. When no
 * listed control contains the hit, the hit element itself is referenced into
 * the live snapshot and observed the same way every listed control was — the
 * same sensitivity, the same form facts — so a canvas or a bare `div` can be
 * grounded without becoming a different kind of target. A child frame is
 * reported as such: its controls are its own frame's refs.
 */
export const hitTestAgentPointInDocument = (input: {
  identity: AgentSnapshotIdentity
  point: { x: number; y: number }
  document: Document
  references: AgentElementReferenceStore
}): AgentHitTestResult => {
  if (!input.references.matches(input.identity)) return null
  const doc = input.document
  if (typeof doc.elementFromPoint !== "function") return null
  const hit = doc.elementFromPoint(input.point.x, input.point.y)
  if (!hit) return null
  if (isFrameElement(hit)) return { frameElement: true }
  let target: Element = hit
  for (
    let current: Element | null = hit;
    current;
    current = composedParent(current)
  ) {
    if (input.references.existingReference(current, input.identity)) {
      target = current
      break
    }
  }
  const ref = input.references.referenceIn(target, input.identity)
  if (!ref) return null
  const element: AgentElement = buildAgentElementObservation(
    target,
    ref,
    input.identity.frameId,
    input.references.verificationIdOf(target)
  )
  return { element }
}
