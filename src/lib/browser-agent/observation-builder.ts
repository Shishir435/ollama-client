import {
  type AgentElement,
  type AgentObservation,
  AgentObservationSchema,
  MAX_AGENT_DESTINATION_URL_CHARS,
  MAX_AGENT_TEXT_CHARS
} from "@ollama-client/contracts"

import { agentEditorText, isAgentEditingHost } from "./editor-page"
import type {
  AgentElementReferenceSnapshot,
  AgentElementReferenceStore
} from "./element-references"
import { agentVisibleGetQuery } from "./form-submission"

export const AGENT_OBSERVATION_LIMITS = {
  elements: 2_000,
  visibleTextChars: 100_000,
  titleChars: 500,
  elementNameChars: 500,
  elementValueChars: MAX_AGENT_TEXT_CHARS,
  elementHrefChars: MAX_AGENT_DESTINATION_URL_CHARS,
  selectOptions: 200,
  selectOptionLabelChars: 500,
  selectOptionValueChars: 2_000,
  documentTextChars: 30_000,
  modals: 10,
  modalLabelChars: 200,
  groupChars: 80,
  /**
   * Matches one scoped read returns. Small on purpose: prompt size is what a
   * decision's latency is mostly made of, and a query answering with two
   * hundred rows would cost more than the omission it exists to fix.
   */
  scopeMatches: 50,
  /**
   * Matches one question of a multi-query lookup returns.
   *
   * Ten rather than fifty, because six questions share one answer: a lookup
   * exists to replace six decisions with one, and an answer six times the
   * size of a scoped read would spend on prompt what it saved on round
   * trips. A question with more matches than this is one `find` away.
   */
  lookupMatches: 10,
  passBudgetMs: 500,
  budgetCheckInterval: 256
} as const

const MODAL_SELECTOR = [
  "dialog[open]",
  "[role='dialog']",
  "[role='alertdialog']",
  "[role='menu']",
  "[role='listbox']"
].join(",")

const LANDMARK_SELECTOR = [
  "main",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "[role='main']",
  "[role='navigation']",
  "[role='banner']",
  "[role='contentinfo']",
  "[role='complementary']",
  "[role='search']"
].join(",")

const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "[role]",
  /**
   * Every editing host, however it spells `true` — the bare attribute and
   * `plaintext-only` included — except one that says `false`, which is how an
   * editor marks a toolbar inside its own document as not editable.
   */
  "[contenteditable]:not([contenteditable='false'])",
  /** A board item or a sortable row is a control a pointer picks up. */
  "[draggable='true']"
].join(",")

const truncate = (value: string, limit: number): string =>
  value.length <= limit ? value : value.slice(0, limit)

const normalizedText = (value: string): string =>
  value.replaceAll(/\s+/g, " ").trim()

interface VisibleBounds {
  bottom: number
  left: number
  right: number
  top: number
}

const intersectBounds = (
  first: VisibleBounds,
  second: VisibleBounds
): VisibleBounds | undefined => {
  const intersection = {
    bottom: Math.min(first.bottom, second.bottom),
    left: Math.max(first.left, second.left),
    right: Math.min(first.right, second.right),
    top: Math.max(first.top, second.top)
  }
  return intersection.right > intersection.left &&
    intersection.bottom > intersection.top
    ? intersection
    : undefined
}

const clipsOverflow = (value: string): boolean =>
  ["auto", "clip", "hidden", "overlay", "scroll"].includes(value)

const isSemanticallyHidden = (element: Element): boolean =>
  element.hasAttribute("hidden") ||
  element.hasAttribute("inert") ||
  element.getAttribute("aria-hidden") === "true"

const isHiddenByStyle = (style: CSSStyleDeclaration): boolean =>
  style.display === "none" ||
  style.visibility === "hidden" ||
  style.visibility === "collapse" ||
  style.contentVisibility === "hidden" ||
  style.opacity === "0"

const isActiveClipValue = (
  value: string | null | undefined,
  defaults: readonly string[]
): boolean => Boolean(value && !defaults.includes(value))

const hasConservativeClip = (
  element: Element,
  style: CSSStyleDeclaration
): boolean => {
  const declared = (element as HTMLElement).style
  return (
    [style.clip, declared.clip].some((value) =>
      isActiveClipValue(value, ["auto", "none"])
    ) ||
    [style.clipPath, declared.clipPath].some((value) =>
      isActiveClipValue(value, ["none"])
    ) ||
    [
      style.maskImage,
      style.getPropertyValue("mask-image"),
      declared.maskImage,
      declared.getPropertyValue("mask-image")
    ].some((value) => isActiveClipValue(value, ["none"]))
  )
}

const clipBoundsByAncestor = (
  bounds: VisibleBounds[],
  ancestor: Element,
  style: CSSStyleDeclaration,
  clips: (value: string) => boolean = clipsOverflow
): VisibleBounds[] => {
  const containPaint = style.contain
    .split(/\s+/)
    .some((value) => value === "paint" || value === "strict")
  const declared = (ancestor as HTMLElement).style
  const clipX =
    containPaint ||
    [
      style.overflow,
      style.overflowX,
      declared.overflow,
      declared.overflowX
    ].some(clips)
  const clipY =
    containPaint ||
    [
      style.overflow,
      style.overflowY,
      declared.overflow,
      declared.overflowY
    ].some(clips)
  if (!clipX && !clipY) return bounds

  const clippingRects = Array.from(ancestor.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0
  )
  return bounds.flatMap((visible) =>
    clippingRects
      .map((rect) =>
        intersectBounds(visible, {
          bottom: clipY ? rect.bottom : visible.bottom,
          left: clipX ? rect.left : visible.left,
          right: clipX ? rect.right : visible.right,
          top: clipY ? rect.top : visible.top
        })
      )
      .filter((rect): rect is VisibleBounds => Boolean(rect))
  )
}

const composedParent = (element: Element): Element | null => {
  const root = element.getRootNode()
  return (
    element.parentElement ?? (root instanceof ShadowRoot ? root.host : null)
  )
}

/**
 * True when `ancestor` is `node` or lies on `node`'s composed-ancestor chain,
 * crossing shadow boundaries the way `composedParent` does. `Node.contains`
 * cannot answer this: it stops at the shadow boundary, so a control inside a
 * component and the light-DOM host that renders it read as unrelated.
 */
const composedContains = (ancestor: Element, node: Element): boolean => {
  for (
    let current: Element | null = node;
    current;
    current = composedParent(current)
  ) {
    if (current === ancestor) return true
  }
  return false
}

/**
 * A node's element view, or null. Tested by `nodeType` rather than
 * `instanceof Element`, because a child frame's nodes belong to that frame's
 * realm and fail an `instanceof` against this realm's constructor — the same
 * observation runs against a child document, and an identity filter there
 * would drop every element it holds.
 */
const asElement = (node: Node): Element | null =>
  node.nodeType === 1 ? (node as Element) : null

/**
 * A slot's assigned nodes in rendered order, or `null` when the element is not
 * a filled slot. `localName` rather than `instanceof HTMLSlotElement` keeps it
 * realm-safe. An empty result reads as `null` so the caller falls through to
 * the slot's own children — its fallback content, which is what renders when
 * nothing is assigned.
 */
const slotAssignedNodes = (element: Element): Node[] | null => {
  if (element.localName !== "slot") return null
  const slot = element as HTMLSlotElement
  if (typeof slot.assignedNodes !== "function") return null
  const assigned = slot.assignedNodes({ flatten: true })
  return assigned.length > 0 ? assigned : null
}

/**
 * The flattened-tree children of a node: what actually renders in its place.
 * A shadow host renders its shadow tree, so its light children are reached
 * only through the slots that project them — never directly, which is what
 * keeps unslotted light content out and stops a filled slot's fallback from
 * being read. A filled slot renders its assigned nodes at that position; an
 * empty one renders its fallback children. Everything else renders its own
 * children.
 */
const flattenedChildren = (node: Node): Node[] => {
  const element = asElement(node)
  if (element) {
    const shadow = element.shadowRoot
    if (shadow) return Array.from(shadow.childNodes)
    const assigned = slotAssignedNodes(element)
    if (assigned) return assigned
  }
  return Array.from(node.childNodes)
}

/**
 * Every element and text node the composed tree reaches, in rendered
 * depth-first order across open shadow roots and slot projections. Each node
 * tree is walked once — a slotted child through its slot, never also at its
 * light-DOM position — so nothing is double-counted and the order matches what
 * the user sees. A closed shadow root is unreachable and stays unread rather
 * than guessed at. `document.querySelectorAll` and a `TreeWalker` both stop at
 * the shadow boundary, which is why a component's controls and text were
 * invisible to every collector below. Iterative so a deep component tree
 * cannot exhaust the stack.
 */
const composedDescendants = function* (
  root: Element | ShadowRoot | Document
): Generator<Node> {
  const stack: Node[] = []
  const pushChildren = (node: Node): void => {
    const children = flattenedChildren(node)
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index])
    }
  }
  pushChildren(root)
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue
    yield node
    pushChildren(node)
  }
}

/**
 * Memo for one observation. Visibility is now resolved for every interactive
 * candidate in the document rather than only the ones that fit the element
 * cap, and the text walk asks the same question once per parent, so resolving
 * a computed style twice was the entire cost of a pass. The DOM cannot change
 * while a pass runs, which is what makes caching its answers sound; a pass is
 * never reused across observations.
 */
interface AgentObservationPass {
  chainHidden: Map<Element, boolean>
  styles: Map<Element, CSSStyleDeclaration | undefined>
  visible: Map<Element, boolean>
  /** True once the pass has spent its wall-clock budget. */
  exhausted(): boolean
}

/**
 * The pass runs synchronously in the page's own main thread, and both of its
 * walks are proportional to the document rather than to the caps — a cap on
 * position is the starvation defect, so neither walk can carry one. What bounds
 * them is time. The clock is read once per `budgetCheckInterval` candidates,
 * so the bound costs nothing on a document that never approaches it.
 */
const createObservationPass = (
  now: () => number = Date.now
): AgentObservationPass => {
  const deadline = now() + AGENT_OBSERVATION_LIMITS.passBudgetMs
  let untilCheck = AGENT_OBSERVATION_LIMITS.budgetCheckInterval
  return {
    chainHidden: new Map(),
    styles: new Map(),
    visible: new Map(),
    exhausted() {
      untilCheck -= 1
      if (untilCheck > 0) return false
      untilCheck = AGENT_OBSERVATION_LIMITS.budgetCheckInterval
      return now() > deadline
    }
  }
}

const styleOf = (
  element: Element,
  pass: AgentObservationPass
): CSSStyleDeclaration | undefined => {
  if (pass.styles.has(element)) return pass.styles.get(element)
  const style =
    element.ownerDocument.defaultView?.getComputedStyle(element) ?? undefined
  pass.styles.set(element, style)
  return style
}

/**
 * Hidden by the element itself or by anything above it, independent of where
 * the viewport happens to be. Walked iteratively so a deep document cannot
 * exhaust the stack, and every element on the walked chain is memoized with
 * the answer the walk reached.
 */
const isChainHidden = (
  element: Element,
  pass: AgentObservationPass
): boolean => {
  const walked: Element[] = []
  let current: Element | null = element
  let hidden = false
  while (current) {
    const cached = pass.chainHidden.get(current)
    if (cached !== undefined) {
      hidden = cached
      break
    }
    const style = styleOf(current, pass)
    if (
      isSemanticallyHidden(current) ||
      !style ||
      isHiddenByStyle(style) ||
      hasConservativeClip(current, style)
    ) {
      pass.chainHidden.set(current, true)
      hidden = true
      break
    }
    walked.push(current)
    current = composedParent(current)
  }
  for (const visited of walked) pass.chainHidden.set(visited, hidden)
  return hidden
}

/**
 * A `type="hidden"` input has no box to see or scroll to, and its value is a
 * token the page keeps for itself. It is answered before visibility and
 * before position, because it is neither on screen nor off it.
 */
const isHiddenInput = (element: Element): boolean =>
  element.tagName === "INPUT" &&
  (element as HTMLInputElement).type?.toLowerCase() === "hidden"

const resolveVisibility = (
  element: Element,
  pass: AgentObservationPass
): boolean => {
  if (isHiddenInput(element)) return false

  /*
   * Visibility is a conjunction of independent predicates, so their order is
   * free — and the element's own box is the cheapest of them. Anything with no
   * box, or none inside the viewport, is answered here without resolving a
   * single computed style, which is what makes scanning a document full of
   * unrendered candidates affordable.
   */
  const view = element.ownerDocument.defaultView
  const viewport = {
    bottom: view?.innerHeight ?? 0,
    left: 0,
    right: view?.innerWidth ?? 0,
    top: 0
  }
  let visibleBounds = Array.from(element.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => intersectBounds(rect, viewport))
    .filter((rect): rect is VisibleBounds => Boolean(rect))
  if (visibleBounds.length === 0) return false
  if (isChainHidden(element, pass)) return false

  for (
    let current = composedParent(element);
    current;
    current = composedParent(current)
  ) {
    const style = styleOf(current, pass)
    if (!style) return false
    visibleBounds = clipBoundsByAncestor(visibleBounds, current, style)
    if (visibleBounds.length === 0) return false
  }
  return true
}

const isVisible = (element: Element, pass: AgentObservationPass): boolean => {
  const cached = pass.visible.get(element)
  if (cached !== undefined) return cached
  const result = resolveVisibility(element, pass)
  pass.visible.set(element, result)
  return result
}

/** Clipped away by an ancestor that cannot be scrolled to reveal it. */
const clipsWithoutScrolling = (value: string): boolean =>
  value === "clip" || value === "hidden"

/**
 * Clipped to nothing by an ancestor whose overflow does not scroll: a
 * collapsed panel held at `height: 0`, a carousel track, a region under
 * `contain: paint`. A scrollable ancestor is deliberately not counted — a row
 * below the fold of a scroll pane is exactly the control this reports, and
 * `scroll` with a container ref reaches it.
 */
const isUnreachablyClipped = (
  element: Element,
  pass: AgentObservationPass
): boolean => {
  let bounds: VisibleBounds[] = Array.from(element.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      top: rect.top
    }))
  if (bounds.length === 0) return true
  for (
    let current = composedParent(element);
    current;
    current = composedParent(current)
  ) {
    const style = styleOf(current, pass)
    if (!style) return true
    bounds = clipBoundsByAncestor(bounds, current, style, clipsWithoutScrolling)
    if (bounds.length === 0) return true
  }
  return false
}

/**
 * Laid out, with nothing above it hiding it, and yet no part of its box falls
 * inside the viewport: a control a scroll brings into reach.
 *
 * `resolveVisibility` answers a conjunction, so it collapses this case into
 * the same `false` as a `display:none` control. An observation that cannot
 * tell the two apart has to treat both as unreadable, which is how nine of
 * every ten rows on an ordinary page arrived as a bare `ref` the model could
 * neither recognise nor act on. Asked separately, a below-fold control keeps
 * its name — and the page's own text already travels below the fold
 * (`collectDocumentText`), so that name is nothing the observation boundary
 * was withholding.
 *
 * Out of the viewport is the whole claim, so the ancestors that clip without
 * scrolling are asked about too. Reporting a control inside a closed
 * accordion as one a scroll brings into reach is worse than not naming it:
 * the run spends steps scrolling for something that is not coming, and the
 * page never says why.
 */
const isOffscreen = (element: Element, pass: AgentObservationPass): boolean => {
  if (isHiddenInput(element)) return false
  const laidOut = Array.from(element.getClientRects()).some(
    (rect) => rect.width > 0 && rect.height > 0
  )
  if (!laidOut || isChainHidden(element, pass)) return false
  return !isUnreachablyClipped(element, pass)
}

/** Inset fractions of a rect to hit-test: the centre, then points pulled off
 * each corner. One reachable point is enough to call the element clickable, so
 * a control a fixed banner clips along one edge is not reported as covered. */
const OCCLUSION_SAMPLES: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0.5],
  [0.15, 0.15],
  [0.85, 0.15],
  [0.15, 0.85],
  [0.85, 0.85]
]

/**
 * A wrapped inline control renders as several client rects, so the hit test
 * runs against each of them and stops at the first that is reachable. Bounded
 * so a pathological control cannot spend the pass on hit tests; the cap only
 * limits how many fragments are consulted, and a control reachable anywhere in
 * its first few fragments is already answered.
 */
const OCCLUSION_MAX_FRAGMENTS = 6

/** Reachable — hit is the element, its own composed subtree, or an ancestor
 * that renders it — versus covered by a foreign element, versus indeterminate
 * when the layout answers nothing. */
type OcclusionProbe = "reachable" | "covered" | "indeterminate"

const probeFragment = (
  element: Element,
  doc: Document,
  rect: VisibleBounds
): OcclusionProbe => {
  const width = rect.right - rect.left
  const height = rect.bottom - rect.top
  for (const [fractionX, fractionY] of OCCLUSION_SAMPLES) {
    const hit = doc.elementFromPoint(
      rect.left + width * fractionX,
      rect.top + height * fractionY
    )
    if (!hit) return "indeterminate"
    if (composedContains(element, hit) || composedContains(hit, element)) {
      return "reachable"
    }
  }
  return "covered"
}

/**
 * Whether another element covers every point a click on `element` would land
 * on, across every fragment it renders as. `elementFromPoint` returns the
 * topmost element in the composed tree, so a hit on the element itself, on its
 * own composed subtree, or on an ancestor that renders it counts as reachable;
 * only a foreign element at every sampled point of every fragment means the
 * control is covered. The hit test needs real layout, so an environment
 * without `elementFromPoint`, or one that answers `null`, yields no occlusion
 * rather than a guessed one — a covered control wrongly shown is recoverable, a
 * reachable control wrongly hidden is not.
 */
/**
 * The point a native pointer should be sent to: the first sampled point of the
 * first fragment that hit-tests back to the element itself. A layout that
 * cannot answer yields the first fragment's centre, mirroring the observation's
 * choice to leave such a control unmarked; a control covered at every sample
 * yields nothing, and the caller refuses rather than click the cover.
 */
export const findAgentReachablePoint = (
  element: Element
): { x: number; y: number } | undefined => {
  const doc = element.ownerDocument
  const view = doc.defaultView
  const viewport = {
    bottom: view?.innerHeight ?? 0,
    left: 0,
    right: view?.innerWidth ?? 0,
    top: 0
  }
  const rects = Array.from(element.getClientRects())
    .filter((box) => box.width > 0 && box.height > 0)
    .map((box) => intersectBounds(box, viewport))
    .filter((box): box is VisibleBounds => Boolean(box))
    .slice(0, OCCLUSION_MAX_FRAGMENTS)
  if (rects.length === 0) return undefined
  const centre = (rect: VisibleBounds) => ({
    x: rect.left + (rect.right - rect.left) / 2,
    y: rect.top + (rect.bottom - rect.top) / 2
  })
  if (!view || typeof doc.elementFromPoint !== "function") {
    return centre(rects[0])
  }
  for (const rect of rects) {
    const width = rect.right - rect.left
    const height = rect.bottom - rect.top
    for (const [fractionX, fractionY] of OCCLUSION_SAMPLES) {
      const x = rect.left + width * fractionX
      const y = rect.top + height * fractionY
      const hit = doc.elementFromPoint(x, y)
      if (!hit) return centre(rect)
      if (composedContains(element, hit) || composedContains(hit, element)) {
        return { x, y }
      }
    }
  }
  return undefined
}

const isOccluded = (element: Element): boolean => {
  const doc = element.ownerDocument
  const view = doc.defaultView
  if (!view || typeof doc.elementFromPoint !== "function") return false
  const viewport = {
    bottom: view.innerHeight ?? 0,
    left: 0,
    right: view.innerWidth ?? 0,
    top: 0
  }
  const rects = Array.from(element.getClientRects())
    .filter((box) => box.width > 0 && box.height > 0)
    .map((box) => intersectBounds(box, viewport))
    .filter((box): box is VisibleBounds => Boolean(box))
    .slice(0, OCCLUSION_MAX_FRAGMENTS)
  if (rects.length === 0) return false
  for (const rect of rects) {
    const probe = probeFragment(element, doc, rect)
    /*
     * One reachable fragment is enough to call the control clickable, and an
     * indeterminate probe is the safe answer that it is: the layout could not
     * confirm coverage, so the control is left unmarked. Only when every
     * fragment is covered by a foreign element is the whole control covered.
     */
    if (probe !== "covered") return false
  }
  return true
}

/**
 * Every region of this document a screenshot must paint over, found by
 * walking the whole composed tree rather than the bounded observation: a
 * sensitive control past the element budget is still on screen. Child frames
 * are masked whole — a frame the run cannot read may hold a sign-in form, and
 * one it can read cannot be placed from here — so an embedded page never
 * leaves in a picture. The scroll position is reported with the rects so a
 * caller can prove the page did not move between two readings.
 */
export const collectAgentMaskRegions = (
  document: Document
): {
  rects: { x: number; y: number; width: number; height: number }[]
  scroll: { x: number; y: number }
} => {
  const view = document.defaultView
  const rects: { x: number; y: number; width: number; height: number }[] = []
  for (const node of composedDescendants(document)) {
    const element = asElement(node)
    if (!element) continue
    const framed =
      element.localName === "iframe" || element.localName === "frame"
    if (!framed && !isSensitiveAgentElement(element)) continue
    for (const box of Array.from(element.getClientRects())) {
      if (box.width <= 0 || box.height <= 0) continue
      rects.push({
        x: box.left,
        y: box.top,
        width: box.width,
        height: box.height
      })
    }
  }
  return {
    rects,
    scroll: { x: view?.scrollX ?? 0, y: view?.scrollY ?? 0 }
  }
}

export const isSensitiveAgentElement = (element: Element): boolean => {
  const input = element as HTMLInputElement
  const type = input.type?.toLowerCase()
  if (["password", "file"].includes(type)) return true
  const evidence = [
    element.getAttribute("autocomplete"),
    element.getAttribute("name"),
    element.getAttribute("id"),
    element.getAttribute("aria-label")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
  return /(?:one-time|otp|verification|passcode|password|card|cc-|cvv|cvc|captcha)/.test(
    evidence
  )
}

/**
 * An editing host's value is its text, read the one way every side reads it
 * (`agentEditorText`). A form control's is its `value` property.
 */
const elementValue = (element: Element): string | undefined => {
  if (isAgentEditingHost(element)) return agentEditorText(element)
  if (!("value" in element)) return undefined
  return String((element as HTMLInputElement).value ?? "")
}

/**
 * `[role]` admits any element, so a candidate is frequently not an
 * `HTMLElement` at all: an `<svg role="img">` or an SVG `<a href>` reaches
 * these derivations with no `type`, no `disabled` and no `isContentEditable`.
 * Reading those properties raw yielded `undefined` where the observation
 * contract requires a boolean, which failed the whole snapshot — the page
 * became unobservable because of one decorative icon. Every field is derived
 * through a check that answers for a non-HTML element too.
 */
const elementType = (element: Element): string | undefined => {
  /**
   * An editing host has no `type` property; it reports one so the model and
   * the affordance rules can tell an editor from the `<div>` it is built on.
   */
  if (isAgentEditingHost(element)) return "contenteditable"
  const declared = (element as Partial<HTMLInputElement>).type
  return typeof declared === "string" && declared.length > 0
    ? declared
    : undefined
}

/**
 * Whether a control's value may hold line breaks. A textarea's always may.
 * An editing host is read from its ARIA: `aria-multiline="true"` says so, a
 * `textbox` without it is single-line by the role's definition, and a host
 * with no role is a document rather than a field, so Enter starts a paragraph.
 * Whether Enter also *sends* — a chat composer's habit — is a page handler
 * this cannot see, which is why typed text never presses Enter at all.
 */
const isMultiline = (element: Element): boolean => {
  if (element instanceof HTMLTextAreaElement) return true
  if (!isAgentEditingHost(element)) return false
  const declared = element.getAttribute("aria-multiline")?.toLowerCase()
  if (declared === "true") return true
  if (declared === "false") return false
  return element.getAttribute("role")?.toLowerCase() !== "textbox"
}

/**
 * Whether the page marks the element as something a pointer picks up. The
 * `draggable` attribute is the HTML5 mark; an ARIA role description saying
 * sortable or draggable is how pointer-based libraries label their items.
 */
const isMarkedDraggable = (element: Element): boolean => {
  if (element.getAttribute("draggable")?.toLowerCase() === "true") return true
  if (element.hasAttribute("aria-grabbed")) return true
  const description = element.getAttribute("aria-roledescription") ?? ""
  return /\b(?:sortable|draggable|drag)/i.test(description)
}

const isEnabled = (element: Element): boolean => {
  const disabled = (element as Partial<HTMLInputElement>).disabled
  return typeof disabled === "boolean" ? !disabled : true
}

const isEditable = (element: Element): boolean =>
  element instanceof HTMLInputElement ||
  element instanceof HTMLTextAreaElement ||
  element instanceof HTMLSelectElement ||
  (element instanceof HTMLElement && element.isContentEditable)

const isCheckableInput = (element: Element): element is HTMLInputElement =>
  element instanceof HTMLInputElement &&
  ["checkbox", "radio"].includes(element.type.toLowerCase())

const isSubmitter = (element: Element): boolean => {
  if (element instanceof HTMLButtonElement) {
    return Boolean(element.form) && element.type.toLowerCase() === "submit"
  }
  return (
    element instanceof HTMLInputElement &&
    Boolean(element.form) &&
    ["submit", "image"].includes(element.type.toLowerCase())
  )
}

export type AgentFormSubmitter = HTMLButtonElement | HTMLInputElement

const formSubmitters = (form: HTMLFormElement): AgentFormSubmitter[] =>
  Array.from(form.elements).filter(
    (control): control is AgentFormSubmitter =>
      control instanceof Element && isSubmitter(control)
  )

/**
 * Native implicit submission activates the form's first submit button. Bind
 * that button while observing an Enter-capable field so its destination,
 * method, validation overrides, and submitted name/value are all part of the
 * effect that receives approval.
 */
export const resolveAgentFormSubmitter = (
  element: Element
): AgentFormSubmitter | undefined => {
  if (isSubmitter(element)) return element as AgentFormSubmitter
  const form = associatedForm(element)
  return form ? formSubmitters(form)[0] : undefined
}

const NON_TEXT_INPUT_TYPES = [
  "button",
  "checkbox",
  "file",
  "hidden",
  "image",
  "radio",
  "reset",
  "submit"
]

const isTextEntryInput = (element: Element): boolean =>
  element instanceof HTMLInputElement &&
  !NON_TEXT_INPUT_TYPES.includes(element.type.toLowerCase())

/**
 * A textarea that is a search box. Enter in a textarea starts a new line, so
 * it was never a submission — but DuckDuckGo and Google both render their
 * search field as a `<textarea name="q">` and submit it from a key handler.
 * Pressed as a plain key, Enter reached the page's own script, which
 * navigated off the approved path, and the step failed on a search the user
 * had asked for. It is a submission when the textarea says it is a single
 * line and is the form's only text entry, in a GET form with a submitter: a
 * newline there means nothing, while a comment box posts, a writing field
 * has rows, and a multi-field form has other fields.
 */
const isSearchTextarea = (element: HTMLTextAreaElement): boolean => {
  const form = element.form
  if (!form || form.method.toLowerCase() !== "get") return false
  /**
   * The field has to say it is one line. Both search pages mark theirs —
   * `rows="1"`, a combobox role, DuckDuckGo's `enterkeyhint="search"` — and
   * a writing field says the opposite, so a lone textarea in a GET form is
   * not enough: Enter there would send an unfinished draft.
   */
  if (element.getAttribute("aria-multiline") === "true") return false
  const role = element.getAttribute("role")
  const singleLine =
    element.getAttribute("rows")?.trim() === "1" ||
    role === "combobox" ||
    role === "searchbox" ||
    element.getAttribute("enterkeyhint") === "search"
  if (!singleLine) return false
  if (formSubmitters(form).length === 0) return false
  return !Array.from(form.elements).some(
    (control) =>
      control !== element &&
      (control instanceof HTMLTextAreaElement || isTextEntryInput(control))
  )
}

const maySubmitWithEnter = (element: Element): boolean => {
  if (element instanceof HTMLTextAreaElement) return isSearchTextarea(element)
  return (
    isTextEntryInput(element) && Boolean((element as HTMLInputElement).form)
  )
}

const associatedForm = (element: Element): HTMLFormElement | null => {
  if (
    element instanceof HTMLButtonElement ||
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    return element.form
  }
  return null
}

const formAction = (element: Element): string | undefined => {
  const form = associatedForm(element)
  if (!form) return undefined
  const submitter = resolveAgentFormSubmitter(element)
  const action = submitter?.hasAttribute("formaction")
    ? String(submitter.formAction)
    : form.action
  return action.length <= MAX_AGENT_DESTINATION_URL_CHARS ? action : undefined
}

const formMethod = (
  element: Element
): "get" | "post" | "dialog" | undefined => {
  const form = associatedForm(element)
  if (!form) return undefined
  const submitter = resolveAgentFormSubmitter(element)
  const method = (
    submitter?.hasAttribute("formmethod")
      ? String(submitter.formMethod)
      : form.method
  ).toLowerCase()
  return method === "post" || method === "dialog" ? method : "get"
}

/**
 * Bounded, non-sensitive evidence for the background resolver. This value is
 * not the execution-time security binding: the content-script reference store
 * separately retains and compares the exact form state, including hidden
 * values, without sending those values across the port.
 */
const stableFormFingerprint = (form: HTMLFormElement): string => {
  const serialized = Array.from(form.elements)
    .map((control) => {
      if (!(control instanceof Element)) return "unknown"
      const input = control as HTMLInputElement
      const type = input.type?.toLowerCase() ?? ""
      const sensitive = type === "hidden" || isSensitiveAgentElement(control)
      return [
        control.tagName.toLowerCase(),
        type,
        control.getAttribute("name") ?? "",
        control.getAttribute("id") ?? "",
        sensitive ? "redacted" : "value" in control ? String(input.value) : "",
        "checked" in control ? String(input.checked) : ""
      ].join("\u001f")
    })
    .join("\u001e")
  let hash = 0x811c9dc5
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

/**
 * A control whose value an approval may show: not sensitive, and not hidden
 * by itself or anything above it — by attribute or by style — since a
 * `display:none` field is a hidden field by another name. Read with the same
 * predicates visibility uses, without the viewport: a search box scrolled
 * out of sight still shows what it holds.
 */
const isShowableFormControl = (control: Element): boolean => {
  if (isSensitiveAgentElement(control)) return false
  const view = control.ownerDocument.defaultView
  for (
    let current: Element | null = control;
    current;
    current = composedParent(current)
  ) {
    if (isSemanticallyHidden(current)) return false
    const style = view?.getComputedStyle(current)
    if (!style || isHiddenByStyle(style)) return false
  }
  return true
}

const hasSensitiveFormControl = (form: HTMLFormElement): boolean =>
  Array.from(form.elements).some((control) => {
    if (!(control instanceof Element)) return false
    // An unused attachment picker contributes no private file to a comment
    // or message. Opening the picker itself stays sensitive, as does a form
    // with selected files (or an unreadable selection). The executor rechecks
    // this fact so a file chosen after approval cannot ride that approval.
    if (control instanceof HTMLInputElement && control.type === "file") {
      return control.files?.length !== 0
    }
    return isSensitiveAgentElement(control)
  })

const selectOptions = (
  element: Element
): AgentElement["options"] | undefined => {
  if (!(element instanceof HTMLSelectElement)) return undefined
  return Array.from(element.options)
    .slice(0, AGENT_OBSERVATION_LIMITS.selectOptions)
    .map((option) => ({
      value: truncate(
        option.value,
        AGENT_OBSERVATION_LIMITS.selectOptionValueChars
      ),
      label: truncate(
        normalizedText(option.label || option.textContent || option.value),
        AGENT_OBSERVATION_LIMITS.selectOptionLabelChars
      ),
      disabled: option.disabled
    }))
}

/**
 * Which of the page's text counts as readable.
 *
 * `viewport` is what the user can see, which is the right question for the
 * page's visible text. `rendered` is everything the page draws, wherever the
 * viewport happens to be, and is the question a below-fold control's own name
 * has to be asked: its label is off screen exactly as it is, so asking for
 * on-screen text would name it nothing at all.
 */
type AgentTextScope = "viewport" | "rendered"

const rendersText = (
  element: Element,
  pass: AgentObservationPass,
  scope: AgentTextScope
): boolean =>
  scope === "viewport"
    ? isVisible(element, pass)
    : !isChainHidden(element, pass)

const collectVisibleText = (
  root: Element,
  limit: number,
  pass: AgentObservationPass,
  scope: AgentTextScope = "viewport"
): string => {
  let result = ""
  for (const node of composedDescendants(root)) {
    if (node.nodeType !== Node.TEXT_NODE) continue
    if (result.length >= limit || pass.exhausted()) break
    const parent = node.parentElement
    if (!parent || !rendersText(parent, pass, scope)) continue
    const text = normalizedText(node.textContent ?? "")
    if (!text) continue
    const addition = `${result ? " " : ""}${text}`
    result += truncate(addition, limit - result.length)
  }
  return result
}

/** A bounded row label beside repeated controls such as Delete buttons. */
const rowContextOf = (
  element: Element,
  pass: AgentObservationPass,
  scope: AgentTextScope
): string | undefined => {
  for (
    let current = composedParent(element);
    current;
    current = composedParent(current)
  ) {
    if (!current.matches("li, tr, [role='row']")) continue
    return collectVisibleText(current, 140, pass, scope) || undefined
  }
  return undefined
}

/**
 * Rendered text wherever it sits in the document, not only where the viewport
 * happens to be. `isVisible` requires viewport intersection, which is right
 * for deciding what can be acted on and wrong for deciding what the page
 * says: a fact below the fold is still a fact the page states.
 */
const collectDocumentText = (
  root: Element,
  limit: number,
  pass: AgentObservationPass
): { text: string; truncated: boolean } => {
  let result = ""
  let truncated = false
  for (const node of composedDescendants(root)) {
    if (node.nodeType !== Node.TEXT_NODE) continue
    /**
     * Running out of budget truncates just as surely as running out of
     * characters. Reporting only the second let a complex page send partial
     * text that looked complete, and an absent fact then reads as a fact the
     * page does not state.
     */
    if (pass.exhausted()) {
      truncated = true
      break
    }
    const parent = node.parentElement
    if (!parent || isChainHidden(parent, pass)) continue
    const text = normalizedText(node.textContent ?? "")
    if (!text) continue
    if (result.length + text.length + 1 > limit) {
      truncated = true
      break
    }
    result += `${result ? " " : ""}${text}`
  }
  return { text: result, truncated }
}

/** A bounded, offset-addressed read; never stops before an oversized text node. */
export const collectAgentTextPage = (
  root: Element,
  offset: number,
  frameId: number,
  limit = 12_000
): NonNullable<AgentObservation["textPage"]> => {
  const pass = createObservationPass()
  let position = 0
  let text = ""
  let more = false
  let scanTruncated = false
  for (const node of composedDescendants(root)) {
    if (pass.exhausted()) {
      scanTruncated = true
      break
    }
    if (node.nodeType !== Node.TEXT_NODE) continue
    const parent = node.parentElement
    if (!parent || isChainHidden(parent, pass)) continue
    const value = normalizedText(node.textContent ?? "")
    if (!value) continue
    const part = `${position ? " " : ""}${value}`
    const end = position + part.length
    if (end > offset) {
      const available = part.slice(Math.max(0, offset - position))
      const room = limit - text.length
      text += available.slice(0, room)
      if (available.length > room) {
        more = true
        break
      }
    }
    position = end
  }
  return {
    text,
    offset,
    frameId,
    ...(more || (scanTruncated && text.length > 0)
      ? { nextOffset: offset + text.length }
      : {}),
    ...(scanTruncated ? { scanTruncated: true } : {})
  }
}

/**
 * Which landmark, form or open dialog owns an element.
 *
 * Two controls with the same accessible name are ordinary — "Delete" in a row
 * and "Delete" in a confirmation are different buttons — and a flat list gives
 * a decision nothing to tell them apart with. The nearest owning region is
 * what does, and it is a structural label rather than page prose.
 */
const groupOf = (
  element: Element,
  modalIds: Map<Element, string>
): string | undefined => {
  for (
    let current: Element | null = element;
    current;
    current = composedParent(current)
  ) {
    const modalId = modalIds.get(current)
    if (modalId) return modalId
    if (current === element) continue
    if (!current.matches(LANDMARK_SELECTOR)) continue
    const role =
      current.getAttribute("role")?.toLowerCase() ||
      current.tagName.toLowerCase()
    /**
     * Read from attributes, never from properties. A form exposes its own
     * controls as named properties, so `form.name` on a form containing
     * `<input name="name">` is that input element rather than a string — and
     * a group label built from it threw, which made the page unobservable.
     */
    const label =
      current.getAttribute("aria-label") ?? current.getAttribute("name")
    const named = label ? `${role} "${normalizedText(label)}"` : role
    return truncate(named, AGENT_OBSERVATION_LIMITS.groupChars)
  }
  return undefined
}

/**
 * Open in-page dialogs and menus, keyed so an element can name its owner.
 * Native `alert`/`confirm`/`prompt` block the page and remain unobservable;
 * `dialogs` in the contract is for those and stays empty here.
 */
const collectModals = (
  document: Document,
  pass: AgentObservationPass
): {
  modals: NonNullable<AgentObservation["modals"]>
  ids: Map<Element, string>
} => {
  const ids = new Map<Element, string>()
  const modals: NonNullable<AgentObservation["modals"]> = []
  for (const candidate of document.querySelectorAll(MODAL_SELECTOR)) {
    if (modals.length >= AGENT_OBSERVATION_LIMITS.modals) break
    if (!isVisible(candidate, pass)) continue
    const role = candidate.getAttribute("role")?.toLowerCase()
    const kind =
      role === "alertdialog" || role === "menu" || role === "listbox"
        ? role
        : "dialog"
    /** Numbered per kind, so `dialog1` and `menu1` can coexist. */
    const ordinal = modals.filter((modal) => modal.kind === kind).length + 1
    const id = `${kind}${ordinal}`
    ids.set(candidate, id)
    const label =
      candidate.getAttribute("aria-label") ??
      accessibleName(candidate, pass) ??
      undefined
    modals.push({
      id,
      kind,
      ...(label
        ? {
            label: truncate(
              normalizedText(label),
              AGENT_OBSERVATION_LIMITS.modalLabelChars
            )
          }
        : {}),
      ...(candidate instanceof HTMLDialogElement &&
      candidate.hasAttribute("open")
        ? { modal: true }
        : {})
    })
  }
  return { modals, ids }
}

/** Editors often render their empty-state hint on a child paragraph. Keep it
 * separate from the ARIA name so either visible label can find the editor. */
const elementPlaceholder = (
  element: Element,
  pass: AgentObservationPass,
  scope: AgentTextScope = "viewport"
): string | undefined => {
  const own =
    element.getAttribute("aria-placeholder") ||
    element.getAttribute("data-placeholder") ||
    element.getAttribute("placeholder")
  if (own) return own
  if (!isAgentEditingHost(element) || element.textContent?.trim())
    return undefined
  let visited = 0
  for (const node of composedDescendants(element)) {
    if (++visited > 128 || pass.exhausted()) break
    const child = asElement(node)
    if (!child || child.closest("[contenteditable]") !== element) continue
    const hint =
      child.getAttribute("data-placeholder") ||
      child.getAttribute("aria-placeholder")
    if (hint && rendersText(child, pass, scope)) return hint
  }
  return undefined
}

const accessibleName = (
  element: Element,
  pass: AgentObservationPass,
  textScope: AgentTextScope = "viewport"
): string | undefined => {
  /**
   * IDREFs resolve within the element's own tree, so a control inside a shadow
   * root is named by a label in that same shadow root — not by `getElementById`
   * on the document, which cannot see into it. `getRootNode` is the shadow root
   * for a shadow element and the document otherwise; both carry
   * `getElementById`, and the duck-typed check stays sound across a child
   * frame's realm.
   */
  const scope = element.getRootNode() as Partial<Document | ShadowRoot>
  const byId: Document | ShadowRoot =
    typeof scope.getElementById === "function"
      ? (scope as Document | ShadowRoot)
      : element.ownerDocument
  const labelledBy = element
    .getAttribute("aria-labelledby")
    ?.trim()
    .split(/\s+/)
    .map((id) => byId.getElementById(id))
    .filter((label): label is HTMLElement => label !== null)
    .map((label) =>
      collectVisibleText(
        label,
        AGENT_OBSERVATION_LIMITS.elementNameChars,
        pass,
        textScope
      )
    )
    .filter(Boolean)
    .join(" ")
  if (labelledBy) return labelledBy
  const labelled = element.getAttribute("aria-label")
  if (labelled) return labelled
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    const label = Array.from(element.labels ?? [])
      .map((label) =>
        collectVisibleText(
          label,
          AGENT_OBSERVATION_LIMITS.elementNameChars,
          pass,
          textScope
        )
      )
      .filter(Boolean)
      .join(" ")
    if (label) return label
  }
  /**
   * An editor's text is its value, not its name: a document named by its own
   * first paragraph would rename itself on every edit and could never be
   * told from the text it holds. Only a placeholder names it.
   */
  if (isAgentEditingHost(element)) {
    const placeholder =
      element.getAttribute("aria-placeholder") ??
      element.getAttribute("data-placeholder") ??
      element.getAttribute("placeholder")
    return placeholder || undefined
  }
  const text = collectVisibleText(
    element,
    AGENT_OBSERVATION_LIMITS.elementNameChars,
    pass,
    textScope
  )
  if (text) return text
  const placeholder = element.getAttribute("placeholder")
  if (placeholder) return placeholder
  return undefined
}

/**
 * Observed destinations exist so navigation can be grounded in a link the page
 * actually rendered rather than a URL the model composed. Anything the user
 * cannot see contributes none: a hidden link is page content the observation
 * boundary already withholds, and `javascript:`/`data:` targets are refused
 * here so they never become a destination the run has to reason about.
 */
const elementHref = (element: Element): string | undefined => {
  const href = element.getAttribute("href")
  if (!href) return undefined
  try {
    const resolved = new URL(href, element.ownerDocument.location.href)
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return undefined
    }
    return resolved.href.length <= AGENT_OBSERVATION_LIMITS.elementHrefChars
      ? resolved.href
      : undefined
  } catch {
    return undefined
  }
}

/**
 * The form facts an element carries.
 *
 * The fingerprint identifies the form the control belongs to and is reported
 * for every control that belongs to one, whether or not that control is on a
 * submit path. It used to be gated on `maySubmit`, which made a `<textarea>`
 * inside a form indistinguishable from a field belonging to no form at all —
 * and "belongs to no form" is exactly the evidence that an edit has no later
 * submission step to be confirmed at.
 *
 * The submission facts stay gated: a destination, a method and `maySubmit`
 * describe what submitting this control would do, and a control that submits
 * nothing has nothing to say about them. The contract requires as much.
 */
const observedFormFields = (
  element: Element,
  maySubmit: boolean
): Partial<AgentElement> => {
  const form = associatedForm(element)
  if (!form && !maySubmit) return {}
  const action = formAction(element)
  const method = formMethod(element)
  const sensitive = Boolean(form && hasSensitiveFormControl(form))
  const query =
    maySubmit && form && action && method === "get" && !sensitive
      ? agentVisibleGetQuery(
          form,
          resolveAgentFormSubmitter(element),
          isShowableFormControl
        )
      : undefined
  return {
    ...(maySubmit && action ? { formAction: action } : {}),
    ...(maySubmit && method ? { formMethod: method } : {}),
    ...(query !== undefined &&
    action &&
    action.length + query.length + 1 <= MAX_AGENT_DESTINATION_URL_CHARS
      ? { formQuery: query }
      : {}),
    ...(form ? { formFingerprint: stableFormFingerprint(form) } : {}),
    ...(maySubmit && sensitive ? { formHasSensitiveControl: true } : {}),
    ...(maySubmit ? { maySubmit: true } : {})
  }
}

const observedControlFields = (
  element: Element,
  value: string | undefined,
  href: string | undefined
): Partial<AgentElement> => {
  const options = selectOptions(element)
  return {
    ...(value !== undefined
      ? {
          value: truncate(value, AGENT_OBSERVATION_LIMITS.elementValueChars)
        }
      : {}),
    ...(href ? { href } : {}),
    ...(href && element.hasAttribute("download") ? { download: true } : {}),
    ...(isCheckableInput(element) ? { checked: element.checked } : {}),
    ...(element === element.ownerDocument.activeElement
      ? { focused: true }
      : {}),
    ...(options ? { options } : {})
  }
}

/**
 * What the run may read off a control: its label, the hint that stands in for
 * one, the value it currently holds and where it leads.
 *
 * Each answer has its own rule, and they are not the same rule. A label is
 * readable wherever the page rendered it — below the fold included, which is
 * where most of a page's controls sit and where stripping the name left the
 * model a bare `ref` it could neither recognise nor act on. A value and a
 * destination are only read where the user can see them, and a sensitive
 * control yields neither anywhere.
 */
const observedContent = (
  element: Element,
  pass: AgentObservationPass,
  placement: { visible: boolean; offscreen: boolean; sensitive: boolean }
): {
  name: string | undefined
  placeholder: string | undefined
  value: string | undefined
  href: string | undefined
} => {
  const readable = placement.visible || placement.offscreen
  const textScope: AgentTextScope = placement.visible ? "viewport" : "rendered"
  return {
    name: readable ? accessibleName(element, pass, textScope) : undefined,
    placeholder:
      placement.sensitive || !readable
        ? undefined
        : elementPlaceholder(element, pass, textScope),
    value:
      placement.sensitive || !placement.visible
        ? undefined
        : elementValue(element),
    href: placement.visible ? elementHref(element) : undefined
  }
}

const buildElementObservation = (
  element: Element,
  ref: string,
  verificationId: string | undefined,
  pass: AgentObservationPass,
  frameId: number,
  modalIds: Map<Element, string> = new Map()
): AgentElement => {
  const visible = isVisible(element, pass)
  const offscreen = !visible && isOffscreen(element, pass)
  const occluded = visible && isOccluded(element)
  /**
   * What the control is, not where it sits. Off screen used to land here,
   * which flagged most of an ordinary page as holding a secret and left the
   * rows that mattered anonymous. A reader that wants "off screen or
   * sensitive" asks for both, and the two that do — the value and the
   * destination — ask about `visible` directly.
   */
  const sensitive = isHiddenInput(element) || isSensitiveAgentElement(element)
  const { name, placeholder, value, href } = observedContent(element, pass, {
    visible,
    offscreen,
    sensitive
  })
  const submitter = isSubmitter(element)
  const maySubmit = submitter || maySubmitWithEnter(element)
  const group = groupOf(element, modalIds)
  const rowContext =
    !sensitive && (visible || offscreen)
      ? rowContextOf(element, pass, visible ? "viewport" : "rendered")
      : undefined
  const scroll = scrollState(element, pass)
  return {
    ref,
    ...(verificationId ? { verificationId } : {}),
    frameId,
    role: element.getAttribute("role") || undefined,
    ...(name
      ? { name: truncate(name, AGENT_OBSERVATION_LIMITS.elementNameChars) }
      : {}),
    ...(placeholder && placeholder !== name
      ? {
          placeholder: truncate(
            placeholder,
            AGENT_OBSERVATION_LIMITS.elementNameChars
          )
        }
      : {}),
    tag: element.tagName.toLowerCase(),
    type: elementType(element),
    ...observedControlFields(element, value, href),
    ...(value !== undefined &&
    value.length > AGENT_OBSERVATION_LIMITS.elementValueChars
      ? { valueTruncated: true }
      : {}),
    ...(scroll ? { scroll } : {}),
    ...observedFormFields(element, maySubmit),
    ...(submitter ? { submitter: true } : {}),
    visible,
    ...(offscreen ? { offscreen: true } : {}),
    ...(occluded ? { occluded: true } : {}),
    enabled: isEnabled(element),
    editable: isEditable(element),
    sensitive,
    ...(isMultiline(element) ? { multiline: true } : {}),
    ...(isMarkedDraggable(element) ? { draggable: true } : {}),
    ...(group ? { group } : {}),
    ...(rowContext ? { rowContext } : {})
  }
}

export const buildAgentElementObservation = (
  element: Element,
  ref: string,
  /** The frame the element lives in; the root frame is 0. Required so a
   * child-frame element is never silently bound to the root document. */
  frameId: number,
  verificationId?: string
): AgentElement =>
  buildElementObservation(
    element,
    ref,
    verificationId,
    createObservationPass(),
    frameId
  )

/**
 * The element cap bounds what crosses the port, but it must never be spent in
 * document order: a page with thousands of hidden controls ahead of the one
 * visible button filled the whole budget with rows carrying no name, value or
 * destination, and the run had nothing left to act on.
 *
 * Bounding the *scan* positionally is the same defect one page-size later, so
 * every candidate the selector matches is resolved, in document order, until
 * the visible budget is full — nothing after that point could enter the set
 * anyway. Hidden candidates are retained only up to the budget they could ever
 * claim, the surplus is dropped from the end, and the result stays in document
 * order, because order is how the model reads structure and how references are
 * numbered.
 */
/** Only real overflow panes are offered as scroll targets. */
const scrollState = (
  element: Element,
  pass: AgentObservationPass
): AgentElement["scroll"] => {
  if (element.clientWidth <= 0 || element.clientHeight <= 0) return undefined
  if (
    element.scrollHeight <= element.clientHeight &&
    element.scrollWidth <= element.clientWidth
  )
    return undefined
  const style = styleOf(element, pass)
  const vertical =
    element.scrollHeight > element.clientHeight &&
    /auto|scroll|overlay/.test(style?.overflowY ?? "")
  const horizontal =
    element.scrollWidth > element.clientWidth &&
    /auto|scroll|overlay/.test(style?.overflowX ?? "")
  if (!vertical && !horizontal) return undefined
  return {
    x: element.scrollLeft,
    y: element.scrollTop,
    viewportWidth: element.clientWidth,
    viewportHeight: element.clientHeight,
    documentWidth: element.scrollWidth,
    documentHeight: element.scrollHeight
  }
}

/**
 * What a scoped read asks the page for.
 *
 * `query` matches a control's own words — its accessible name, its value, its
 * placeholder. `region` matches the group a control sits in, which is the
 * same grouping the overview labels its rows with, so the model asks for a
 * region using the name it was already shown.
 */
export interface AgentObservationScope {
  kind: "query" | "region"
  value: string
  offset?: number
}

const scopeHaystack = (
  element: Element,
  pass: AgentObservationPass
): string => {
  const parts = [
    /**
     * Rendered, not viewport. A scoped read exists to reach controls the
     * overview could not carry, and those are below the fold by definition —
     * asking for their names under viewport scope returns nothing, so the
     * query matched zero on the very page it was built for.
     */
    accessibleName(element, pass, "rendered"),
    element.getAttribute("placeholder"),
    element.getAttribute("aria-placeholder"),
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
      ? element.value
      : undefined
  ]
  return parts.filter(Boolean).join(" ").toLowerCase()
}

/**
 * The whole document, filtered, rather than the overview's first page of it.
 *
 * `find` and `inspect` used to re-rank `observation.elements` — the list the
 * overview had already capped at 2,000 under a 500ms budget. A control the
 * capture never reached could not be recovered by any later query or any
 * context window, because nothing went back to the page. This walks the
 * document itself and keeps only what the scope matches, so the cap bounds
 * one answer instead of the run's whole sight of the page.
 *
 * Running out of budget stops the walk and is reported as `nextOffset`,
 * where the overview throws. The overview throwing is right — a truncated
 * overview is a snapshot that silently omits what the run needs. Here the
 * continuation *is* the feature, and refusing to answer a large page would
 * refuse exactly the page this was built for.
 */
const selectScopedCandidates = (
  document: Document,
  pass: AgentObservationPass,
  scope: AgentObservationScope,
  modalIds: Map<Element, string>,
  limit: number
): { matches: Element[]; nextOffset?: number; cut?: boolean } => {
  const offset = Math.max(0, scope.offset ?? 0)
  const needle = scope.value.trim().toLowerCase()
  const matches: Element[] = []
  let seen = 0
  if (limit <= 0 || needle.length === 0) return { matches }

  for (const node of composedDescendants(document.documentElement)) {
    const candidate = asElement(node)
    if (!candidate?.matches(INTERACTIVE_SELECTOR)) continue
    if (pass.exhausted())
      return { matches, nextOffset: offset + matches.length, cut: true }
    const hit =
      scope.kind === "region"
        ? groupOf(candidate, modalIds)?.toLowerCase() === needle
        : scopeHaystack(candidate, pass).includes(needle)
    if (!hit) continue
    seen += 1
    if (seen <= offset) continue
    /**
     * The match past the limit is what proves there is a next page, so it is
     * looked for rather than assumed. Setting `nextOffset` on a full page
     * claimed more whenever a total landed on a multiple of the limit, and
     * the model spent a decision and an observation collecting nothing.
     */
    if (matches.length >= limit)
      return { matches, nextOffset: offset + matches.length }
    matches.push(candidate)
  }
  return { matches }
}

/** What a multi-query lookup asks the page for, in one walk. */
export interface AgentObservationLookup {
  queries: readonly string[]
}

/**
 * Several questions answered by one pass of the document.
 *
 * `find` already walks the page, so asking it three questions costs three
 * decisions, three walks and three full observations. This tests every needle
 * against each candidate as it goes: the walk is the expensive half and it
 * happens once, and the answer stays grouped so the model can tell which
 * question each row belongs to.
 *
 * A question that matched nothing keeps its group with no rows. Dropping it
 * would leave the model unable to distinguish a question it never asked from
 * one the page did not answer — and "this page has no SKU field" is usually
 * the more useful of the two answers.
 */
interface LookupGroup {
  query: string
  needle: string
  elements: Element[]
  truncated: boolean
}

interface LookupAnswer {
  matches: Element[]
  groups: { query: string; elements: Element[]; truncated?: boolean }[]
  cut?: boolean
}

/** The groups as they leave, without the needle the walk matched them by. */
const publishedLookupGroups = (
  groups: readonly LookupGroup[]
): LookupAnswer["groups"] =>
  groups.map(({ query, elements, truncated }) => ({
    query,
    elements,
    ...(truncated ? { truncated: true } : {})
  }))

/**
 * Every group the budget cut short is marked, not only the ones that filled
 * up. A question abandoned mid-walk has an incomplete answer, and one that
 * looks complete is the difference between narrowing the query and believing
 * the page holds nothing more.
 */
const markUnfinishedGroups = (
  groups: readonly LookupGroup[],
  perQuery: number
): void => {
  for (const group of groups) {
    if (group.elements.length >= perQuery) continue
    group.truncated = true
  }
}

/** Files one candidate under every question whose needle it answers. */
const collectLookupMatch = (
  candidate: Element,
  haystack: string,
  groups: readonly LookupGroup[],
  perQuery: number,
  collected: { matches: Element[]; seen: Set<Element> }
): void => {
  for (const group of groups) {
    if (group.needle.length === 0) continue
    if (!haystack.includes(group.needle)) continue
    if (group.elements.length >= perQuery) {
      group.truncated = true
      continue
    }
    group.elements.push(candidate)
    if (collected.seen.has(candidate)) continue
    collected.seen.add(candidate)
    collected.matches.push(candidate)
  }
}

const selectLookupCandidates = (
  document: Document,
  pass: AgentObservationPass,
  lookup: AgentObservationLookup,
  limit: number
): LookupAnswer => {
  const perQuery = Math.max(
    0,
    Math.min(limit, AGENT_OBSERVATION_LIMITS.lookupMatches)
  )
  const groups: LookupGroup[] = lookup.queries.map((query) => ({
    query,
    needle: query.trim().toLowerCase(),
    elements: [],
    truncated: false
  }))
  const collected = { matches: [] as Element[], seen: new Set<Element>() }
  if (perQuery === 0) {
    return { matches: collected.matches, groups: publishedLookupGroups(groups) }
  }

  for (const node of composedDescendants(document.documentElement)) {
    const candidate = asElement(node)
    if (!candidate?.matches(INTERACTIVE_SELECTOR)) continue
    if (pass.exhausted()) {
      markUnfinishedGroups(groups, perQuery)
      return {
        matches: collected.matches,
        groups: publishedLookupGroups(groups),
        cut: true
      }
    }
    collectLookupMatch(
      candidate,
      scopeHaystack(candidate, pass),
      groups,
      perQuery,
      collected
    )
  }
  return { matches: collected.matches, groups: publishedLookupGroups(groups) }
}

const selectObservedCandidates = (
  document: Document,
  pass: AgentObservationPass,
  budget: number
): Element[] => {
  if (budget <= 0) return []
  const selected: Element[] = []
  const hiddenPositions: number[] = []
  let visibleCount = 0

  for (const node of composedDescendants(document.documentElement)) {
    const candidate = asElement(node)
    if (
      !candidate ||
      (!candidate.matches(INTERACTIVE_SELECTOR) &&
        !scrollState(candidate, pass))
    )
      continue
    /*
     * A truncated selection is the defect this function exists to prevent, so
     * running out of budget here is reported rather than absorbed: the run is
     * told the page could not be read, which is true, instead of being handed
     * a snapshot that silently omits the control it needs. Text collection
     * takes the opposite branch, because it is already a truncating field.
     */
    if (pass.exhausted()) {
      throw new Error(
        `Agent observation exceeded its ${AGENT_OBSERVATION_LIMITS.passBudgetMs}ms budget`
      )
    }
    if (isVisible(candidate, pass)) {
      selected.push(candidate)
      visibleCount += 1
      if (visibleCount >= budget) break
      continue
    }
    if (hiddenPositions.length >= budget) continue
    hiddenPositions.push(selected.length)
    selected.push(candidate)
  }

  const hiddenBudget = budget - visibleCount
  if (hiddenPositions.length <= hiddenBudget) return selected
  const surplus = new Set(hiddenPositions.slice(Math.max(0, hiddenBudget)))
  return selected.filter((_element, index) => !surplus.has(index))
}

/**
 * The frame a document is in has to agree with the frame the request named.
 * A content script cannot read its own extension frame id, so this is the
 * one check it can make: the root frame is the top window and nothing else
 * is. `top` is readable across origins even when nothing behind it is.
 */
const assertFrameRole = (document: Document, frameId: number): void => {
  const view = document.defaultView
  const isTop = !view || view.top === view
  if (frameId === 0 && !isTop) {
    throw new Error("Agent root-frame observation requested from a child frame")
  }
  if (frameId !== 0 && isTop) {
    throw new Error(
      "Agent child-frame observation requested from the top frame"
    )
  }
}

/**
 * Whether a scoped walk's answer stands as the observation, or the page
 * should be described instead.
 *
 * A miss falls back to the overview, so the model has the page it missed on
 * rather than an empty answer — otherwise a misnamed region reads as an empty
 * page, which is how a run spent twenty-one observations asking for the same
 * region over and over. The descriptor says `returned: 0` either way, so the
 * miss is stated.
 *
 * Not when the budget is gone, though: building an overview then throws, and
 * a run that only asked for the next page of a scoped read fails. The pass is
 * asked directly rather than trusting the walk to have noticed, because the
 * budget is checked on an interval and a walk can finish just past the
 * deadline without ever observing it.
 */
const scopedAnswerStands = (
  scoped: { matches: Element[]; cut?: boolean } | undefined,
  pass: AgentObservationPass
): scoped is { matches: Element[]; cut?: boolean } =>
  scoped !== undefined &&
  (scoped.matches.length > 0 || scoped.cut === true || pass.exhausted())

/**
 * Which elements this observation carries: a scope's matches, a lookup's, or
 * the page's own overview.
 *
 * Both scoped forms fall back to the overview when they matched nothing and
 * the budget still holds, because a misnamed region or an unanswered question
 * reads as an empty page otherwise — and an empty page is the one answer that
 * makes a run ask the same thing again. The descriptors still report zero, so
 * the miss is stated rather than hidden behind the rows it fell back to.
 */
/**
 * The descriptors that say what question this observation answers.
 *
 * Present only when one was asked, and reporting the page's own figures —
 * the projection trims them later against what the model can actually see.
 * A scoped read carries its offset and continuation; a lookup carries its
 * groups, empty ones included, because an unanswered question and an unasked
 * one are different facts.
 */
const scopedAnswerFields = (
  scope: AgentObservationScope | undefined,
  scoped: { matches: Element[]; nextOffset?: number } | undefined,
  lookupGroups:
    | { query: string; refs: string[]; truncated?: boolean }[]
    | undefined
): Partial<AgentObservation> => ({
  ...(lookupGroups ? { lookup: { queries: lookupGroups } } : {}),
  ...(scope && scoped
    ? {
        scope: {
          kind: scope.kind,
          value: scope.value,
          offset: Math.max(0, scope.offset ?? 0),
          returned: scoped.matches.length,
          ...(scoped.nextOffset === undefined
            ? {}
            : { nextOffset: scoped.nextOffset })
        }
      }
    : {})
})

/**
 * A group names the rows it matched by the refs this observation just assigned
 * them.
 *
 * When the lookup matched nothing the walk fell back to an overview and the
 * groups are empty — which is the answer, not a gap: the model is told the
 * page carries no control matching any of its questions, and is handed the
 * overview to work out why. A ref the snapshot never assigned is dropped
 * rather than invented, because a group naming a row the model cannot see is
 * worse than a group that is short.
 */
const publishedLookupRefs = (
  looked: LookupAnswer | undefined,
  snapshot: AgentElementReferenceSnapshot
): { query: string; refs: string[]; truncated?: boolean }[] | undefined =>
  looked?.groups.map((group) => ({
    query: group.query,
    refs: group.elements
      .map((element) => snapshot.referenceOf(element))
      .filter((ref): ref is string => ref !== undefined),
    ...(group.truncated ? { truncated: true } : {})
  }))

const selectObservationCandidates = (input: {
  document: Document
  pass: AgentObservationPass
  modalIds: Map<Element, string>
  elementLimit: number
  scope?: AgentObservationScope
  lookup?: AgentObservationLookup
}): {
  scoped?: { matches: Element[]; nextOffset?: number; cut?: boolean }
  looked?: LookupAnswer
  candidates: Element[]
} => {
  const bound = Math.min(
    input.elementLimit,
    AGENT_OBSERVATION_LIMITS.scopeMatches
  )
  const scoped = input.scope
    ? selectScopedCandidates(
        input.document,
        input.pass,
        input.scope,
        input.modalIds,
        bound
      )
    : undefined
  if (scopedAnswerStands(scoped, input.pass)) {
    return { scoped, candidates: scoped.matches }
  }
  const looked =
    input.lookup && !input.scope
      ? selectLookupCandidates(input.document, input.pass, input.lookup, bound)
      : undefined
  if (scopedAnswerStands(looked, input.pass)) {
    return {
      ...(scoped ? { scoped } : {}),
      looked,
      candidates: looked.matches
    }
  }
  return {
    ...(scoped ? { scoped } : {}),
    ...(looked ? { looked } : {}),
    candidates: selectObservedCandidates(
      input.document,
      input.pass,
      input.elementLimit
    )
  }
}

export const buildAgentObservation = (input: {
  document: Document
  tabId: number
  documentId: string
  /** The extension frame id of `document`; the root frame is 0. */
  frameId?: number
  minimumGeneration: number
  references: AgentElementReferenceStore
  /**
   * Elements this frame may contribute. A composed observation hands a child
   * frame what the root left over, so one page cannot exceed the cap by
   * spreading its controls across frames.
   */
  elementLimit?: number
  /**
   * A scoped read. When present the elements are the scope's matches rather
   * than the page's overview, because the two answer different questions and
   * returning both would spend the element cap twice.
   */
  scope?: AgentObservationScope
  /**
   * Several scoped questions answered together. Mutually exclusive with
   * `scope` in practice — both replace the overview with their own matches,
   * and a request carrying both would spend the element cap twice — and the
   * caller that builds them never sets both.
   */
  lookup?: AgentObservationLookup
  textOffset?: number
  capturedAt?: number
  createSnapshotId?: () => string
  now?: () => number
}): AgentObservation => {
  const frameId = input.frameId ?? 0
  assertFrameRole(input.document, frameId)
  const elementLimit = Math.min(
    AGENT_OBSERVATION_LIMITS.elements,
    Math.max(0, input.elementLimit ?? AGENT_OBSERVATION_LIMITS.elements)
  )
  const url = new URL(input.document.location.href)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Agent observations require an HTTP(S) document")
  }
  const snapshot = input.references.beginSnapshot({
    minimumGeneration: input.minimumGeneration,
    createSnapshotId:
      input.createSnapshotId ?? (() => globalThis.crypto.randomUUID())
  })
  const pass = createObservationPass(input.now)
  const { modals, ids: modalIds } = collectModals(input.document, pass)
  const { scoped, looked, candidates } = selectObservationCandidates({
    document: input.document,
    pass,
    modalIds,
    elementLimit,
    ...(input.scope ? { scope: input.scope } : {}),
    ...(input.lookup ? { lookup: input.lookup } : {})
  })
  const elements = candidates.map((element) =>
    buildElementObservation(
      element,
      snapshot.reference(element),
      snapshot.verificationId(element),
      pass,
      frameId,
      modalIds
    )
  )
  const lookupGroups = publishedLookupRefs(looked, snapshot)
  const visibleText = input.document.body
    ? collectVisibleText(
        input.document.body,
        AGENT_OBSERVATION_LIMITS.visibleTextChars,
        pass
      )
    : ""
  /**
   * Only sent when it says more than the viewport already did, so an ordinary
   * short page does not pay for the field twice.
   */
  const documentText = input.document.body
    ? collectDocumentText(
        input.document.body,
        AGENT_OBSERVATION_LIMITS.documentTextChars,
        pass
      )
    : { text: "", truncated: false }
  const view = input.document.defaultView
  const root = input.document.documentElement

  return AgentObservationSchema.parse({
    snapshotId: snapshot.snapshotId,
    generation: snapshot.generation,
    tabId: input.tabId,
    frameId,
    documentId: input.documentId,
    url: url.href,
    origin: url.origin,
    title: truncate(input.document.title, AGENT_OBSERVATION_LIMITS.titleChars),
    /**
     * A single frame's observation lists itself. Composition into the page's
     * frame tree happens where the tree is known, in the background.
     */
    frames: [
      {
        frameId,
        documentId: input.documentId,
        origin: url.origin,
        url: url.href,
        access: "ok",
        snapshotId: snapshot.snapshotId,
        generation: snapshot.generation
      }
    ],
    elements,
    ...scopedAnswerFields(input.scope, scoped, lookupGroups),
    visibleText,
    ...(input.textOffset === undefined || !input.document.body
      ? {}
      : {
          textPage: collectAgentTextPage(
            input.document.body,
            input.textOffset,
            frameId
          )
        }),
    scroll: {
      x: view?.scrollX ?? 0,
      y: view?.scrollY ?? 0,
      viewportWidth: view?.innerWidth ?? root.clientWidth,
      viewportHeight: view?.innerHeight ?? root.clientHeight,
      documentWidth: Math.max(root.scrollWidth, root.clientWidth),
      documentHeight: Math.max(root.scrollHeight, root.clientHeight)
    },
    dialogs: [],
    ...(modals.length > 0 ? { modals } : {}),
    ...(documentText.text && documentText.text !== visibleText
      ? { documentText: documentText.text }
      : {}),
    ...(documentText.truncated ? { documentTextTruncated: true } : {}),
    capturedAt: input.capturedAt ?? Date.now()
  })
}
