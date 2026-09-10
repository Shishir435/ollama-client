import type {
  AgentElement,
  AgentSnapshotIdentity
} from "@ollama-client/contracts"

import type { AgentHitTestResult, AgentSensitiveRegions } from "./control-port"
import type { AgentElementReferenceStore } from "./element-references"
import {
  buildAgentElementObservation,
  collectAgentMaskRegions
} from "./observation-builder"

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

/**
 * Everything a picture of this document must cover, read from the whole
 * composed tree right now, or nothing when this document is not the snapshot
 * the request named. Not bounded by the observation: a control the overview
 * left out is still on screen.
 */
export const collectAgentSensitiveRegionsInDocument = (input: {
  identity: AgentSnapshotIdentity
  document: Document
  references: AgentElementReferenceStore
}): AgentSensitiveRegions => {
  if (!input.references.matches(input.identity)) return null
  return collectAgentMaskRegions(input.document)
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
