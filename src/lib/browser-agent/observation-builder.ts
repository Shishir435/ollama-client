import {
  type AgentElement,
  type AgentObservation,
  AgentObservationSchema,
  MAX_AGENT_DESTINATION_URL_CHARS
} from "@ollama-client/contracts"

import type { AgentElementReferenceStore } from "./element-references"

export const AGENT_OBSERVATION_LIMITS = {
  elements: 2_000,
  visibleTextChars: 100_000,
  titleChars: 500,
  elementNameChars: 500,
  elementValueChars: 500,
  elementHrefChars: MAX_AGENT_DESTINATION_URL_CHARS,
  selectOptions: 200,
  selectOptionLabelChars: 500,
  selectOptionValueChars: 2_000,
  documentTextChars: 30_000,
  modals: 10,
  modalLabelChars: 200,
  groupChars: 80,
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
  "[contenteditable='true']"
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
  style: CSSStyleDeclaration
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
    ].some(clipsOverflow)
  const clipY =
    containPaint ||
    [
      style.overflow,
      style.overflowY,
      declared.overflow,
      declared.overflowY
    ].some(clipsOverflow)
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

const resolveVisibility = (
  element: Element,
  pass: AgentObservationPass
): boolean => {
  if (
    element instanceof HTMLInputElement &&
    element.type.toLowerCase() === "hidden"
  ) {
    return false
  }

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

const elementValue = (element: Element): string | undefined => {
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
  const declared = (element as Partial<HTMLInputElement>).type
  return typeof declared === "string" && declared.length > 0
    ? declared
    : undefined
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

const maySubmitWithEnter = (element: Element): boolean => {
  if (!(element instanceof HTMLInputElement) || !element.form) return false
  return ![
    "button",
    "checkbox",
    "file",
    "hidden",
    "image",
    "radio",
    "reset",
    "submit"
  ].includes(element.type.toLowerCase())
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

const hasSensitiveFormControl = (form: HTMLFormElement): boolean =>
  Array.from(form.elements).some(
    (control) => control instanceof Element && isSensitiveAgentElement(control)
  )

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

const collectVisibleText = (
  root: Element,
  limit: number,
  pass: AgentObservationPass
): string => {
  let result = ""
  for (const node of composedDescendants(root)) {
    if (node.nodeType !== Node.TEXT_NODE) continue
    if (result.length >= limit || pass.exhausted()) break
    const parent = node.parentElement
    if (!parent || !isVisible(parent, pass)) continue
    const text = normalizedText(node.textContent ?? "")
    if (!text) continue
    const addition = `${result ? " " : ""}${text}`
    result += truncate(addition, limit - result.length)
  }
  return result
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

const accessibleName = (
  element: Element,
  pass: AgentObservationPass
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
      collectVisibleText(label, AGENT_OBSERVATION_LIMITS.elementNameChars, pass)
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
          pass
        )
      )
      .filter(Boolean)
      .join(" ")
    if (label) return label
  }
  const text = collectVisibleText(
    element,
    AGENT_OBSERVATION_LIMITS.elementNameChars,
    pass
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

const observedFormFields = (
  element: Element,
  maySubmit: boolean
): Partial<AgentElement> => {
  if (!maySubmit) return {}
  const form = associatedForm(element)
  const action = formAction(element)
  const method = formMethod(element)
  return {
    ...(action ? { formAction: action } : {}),
    ...(method ? { formMethod: method } : {}),
    ...(form ? { formFingerprint: stableFormFingerprint(form) } : {}),
    ...(form && hasSensitiveFormControl(form)
      ? { formHasSensitiveControl: true }
      : {}),
    maySubmit: true
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

const buildElementObservation = (
  element: Element,
  ref: string,
  verificationId: string | undefined,
  pass: AgentObservationPass,
  frameId: number,
  modalIds: Map<Element, string> = new Map()
): AgentElement => {
  const visible = isVisible(element, pass)
  const occluded = visible && isOccluded(element)
  const sensitive = !visible || isSensitiveAgentElement(element)
  const name = visible ? accessibleName(element, pass) : undefined
  const value = sensitive ? undefined : elementValue(element)
  const href = visible ? elementHref(element) : undefined
  const submitter = isSubmitter(element)
  const maySubmit = submitter || maySubmitWithEnter(element)
  const group = groupOf(element, modalIds)
  return {
    ref,
    ...(verificationId ? { verificationId } : {}),
    frameId,
    role: element.getAttribute("role") || undefined,
    ...(name
      ? { name: truncate(name, AGENT_OBSERVATION_LIMITS.elementNameChars) }
      : {}),
    tag: element.tagName.toLowerCase(),
    type: elementType(element),
    ...observedControlFields(element, value, href),
    ...observedFormFields(element, maySubmit),
    ...(submitter ? { submitter: true } : {}),
    visible,
    ...(occluded ? { occluded: true } : {}),
    enabled: isEnabled(element),
    editable: isEditable(element),
    sensitive,
    ...(group ? { group } : {})
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
const selectObservedCandidates = (
  document: Document,
  pass: AgentObservationPass,
  budget: number
): Element[] => {
  const selected: Element[] = []
  const hiddenPositions: number[] = []
  let visibleCount = 0

  for (const node of composedDescendants(document.documentElement)) {
    const candidate = asElement(node)
    if (!candidate?.matches(INTERACTIVE_SELECTOR)) continue
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
  const elements = selectObservedCandidates(
    input.document,
    pass,
    elementLimit
  ).map((element) =>
    buildElementObservation(
      element,
      snapshot.reference(element),
      snapshot.verificationId(element),
      pass,
      frameId,
      modalIds
    )
  )
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
    visibleText,
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
