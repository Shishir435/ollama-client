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
 *
 * A listed ancestor is only the better answer while it is one the run could
 * act on. An ancestor with no box of its own — `display: contents`, a wrapper
 * its children are positioned out of, one an overflow clips to nothing —
 * observes as not visible, and answering with it handed the resolver a target
 * it refuses by rule. The pointer is over the point either way, so the walk
 * passes over an ancestor it cannot use and keeps looking; the hit element
 * itself is the floor. A run spent its whole budget clicking the same
 * screenshot point and being told the control it named was not visible.
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
  const observe = (element: Element, ref: string): AgentElement =>
    buildAgentElementObservation(
      element,
      ref,
      input.identity.frameId,
      input.references.verificationIdOf(element)
    )
  for (
    let current: Element | null = hit;
    current;
    current = composedParent(current)
  ) {
    const ref = input.references.existingReference(current, input.identity)
    if (!ref) continue
    const listed = observe(current, ref)
    if (listed.visible) return { element: listed }
  }
  const ref = input.references.referenceIn(hit, input.identity)
  if (!ref) return null
  return { element: observe(hit, ref) }
}
