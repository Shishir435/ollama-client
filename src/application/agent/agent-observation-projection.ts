import type { AgentElement, AgentObservation } from "@ollama-client/contracts"

/**
 * What the model is actually given for a page.
 *
 * The whole observation used to be serialized into the prompt, and most of it
 * is not the model's business: `frameId` is always 0, `verificationId` is the
 * executor's binding, a form fingerprint is a hash the run compares, and a
 * flag whose value is the default says nothing. On a real page that noise is
 * most of the payload, and a payload that large is what pushes the system
 * prompt and the tool schema out of a small model's context window.
 *
 * The projection keeps the same shape rather than inventing a text format:
 * refs stay authoritative and unambiguous, and every field that remains is
 * one a decision can act on. The runtime keeps the exact observation for
 * grounding and verification; this is only what travels.
 */
export interface AgentProjectedElement {
  ref: string
  tag: string
  role?: string
  name?: string
  type?: string
  value?: string
  checked?: boolean
  focused?: boolean
  href?: string
  options?: { value: string; label?: string }[]
  /** The landmark, form or dialog this element belongs to. */
  group?: string
  /** Present only when true, because the default is what most rows are. */
  submits?: boolean
  editable?: boolean
  sensitive?: boolean
  disabled?: boolean
  hidden?: boolean
  /** Present only when a cover sits over the control, so the model dismisses
   * it or scrolls rather than clicking a point the pointer cannot reach. */
  occluded?: boolean
}

/**
 * A frame the page holds, as the model needs to know it: which frame a ref's
 * prefix names, and whether the run was able to read it. A frame the run did
 * not read shows its origin and why, so the model can ask for it rather than
 * concluding the control is not there.
 */
export interface AgentProjectedFrame {
  frameId: number
  origin: string
  access: AgentObservation["frames"][number]["access"]
}

export interface AgentProjectedObservation {
  url: string
  title: string
  /** Present only when the page has frames beyond its root. */
  frames?: AgentProjectedFrame[]
  /** Child frames the frame cap left unread and unlisted. */
  omittedFrames?: number
  scroll: { y: number; ofDocument: number }
  /** Open dialogs and menus, so a decision can act inside the top one. */
  modals?: { id: string; label?: string; kind: string }[]
  /** Text inside the viewport. */
  text: string
  /** The rest of the document, when there is any and it fits. */
  documentText?: string
  documentTextTruncated?: boolean
  /** Set when the viewport text was cut to fit the page-content budget, so an
   * absent string is not read as a fact the page does not state. */
  textTruncated?: boolean
  elements: AgentProjectedElement[]
  /**
   * Controls the overview left out to stay within budget, counted by the
   * region that holds them. The model is told a region has more than it can
   * see so it can `inspect` that region rather than concluding the control is
   * not there. Present only in a budgeted overview that dropped something.
   */
  omittedByGroup?: { group: string; count: number }[]
}

/** A region the model asked to see in full; its controls survive the budget. */
export interface AgentProjectionOptions {
  /**
   * Character budget for the projected page content — its elements and text
   * together. Omitted means no budget: every control and the full text
   * travel, as they did before progressive inspection existed.
   */
  pageContentChars?: number
  /**
   * The hard ceiling for page content — the most an expanded region, a broad
   * query or extracted text may occupy so the whole prompt still fits the
   * context window. Defaults to `pageContentChars`, i.e. no expansion room,
   * when omitted.
   */
  pageContentMaxChars?: number
  /**
   * What the model asked to see more of. Exactly one is expanded past the
   * overview budget, up to the ceiling: `region` shows one group's controls,
   * `query` the controls matching it, and `text` the page's full text — the
   * below-fold document included — rather than the budgeted excerpt.
   */
  focus?: { region?: string; query?: string; text?: boolean }
}

export const AGENT_PROJECTION_LIMITS = {
  /**
   * A name is prose the model reads and never has to reproduce, so it can be
   * shortened: the observation's own 500-character cap is generous for a
   * prompt, and two thousand rows of it is most of a small model's window.
   *
   * A `value` gets no such cap. For a select it has to match an option
   * exactly, and for any field it is what tells the model whether the field
   * already holds what the goal wants — an altered one is worse than a
   * missing one.
   */
  nameChars: 200
} as const

/**
 * The one field that is not reduced.
 *
 * An option's value is the payload of a `select`, and the executor requires
 * exact equality against the option the page actually holds — so a truncated
 * value is unselectable and an omitted option is unreachable. Capping either
 * does not make the page cheaper to read, it makes part of it impossible to
 * use. Disabled options are dropped because the executor refuses them anyway,
 * and a label travels only when it says something the value does not.
 *
 * The bound that matters is the observation's own: two hundred options, each
 * at most two thousand characters.
 */
const projectOptions = (
  element: AgentElement
): AgentProjectedElement["options"] => {
  if (!element.options?.length) return undefined
  const enabled = element.options.filter((option) => !option.disabled)
  return enabled.length > 0
    ? enabled.map((option) => ({
        value: option.value,
        ...(option.label && option.label !== option.value
          ? { label: option.label }
          : {})
      }))
    : undefined
}

export const projectAgentElement = (
  element: AgentElement
): AgentProjectedElement => {
  const options = projectOptions(element)
  return {
    ref: element.ref,
    tag: element.tag,
    ...(element.role ? { role: element.role } : {}),
    ...(element.name
      ? { name: element.name.slice(0, AGENT_PROJECTION_LIMITS.nameChars) }
      : {}),
    ...(element.type ? { type: element.type } : {}),
    ...(element.value !== undefined ? { value: element.value } : {}),
    ...(element.checked !== undefined ? { checked: element.checked } : {}),
    ...(element.focused ? { focused: true } : {}),
    ...(element.href ? { href: element.href } : {}),
    ...(options ? { options } : {}),
    ...(element.group ? { group: element.group } : {}),
    ...(element.submitter || element.maySubmit ? { submits: true } : {}),
    ...(element.editable ? { editable: true } : {}),
    ...(element.sensitive ? { sensitive: true } : {}),
    ...(element.enabled ? {} : { disabled: true }),
    ...(element.visible ? {} : { hidden: true }),
    ...(element.occluded ? { occluded: true } : {})
  }
}

/** The share of a page-content budget the viewport text may take before the
 * rest goes to controls. Controls are what a decision acts on, so text yields
 * to them; enough is kept to read the page's own words. */
const AGENT_OVERVIEW_TEXT_SHARE = 0.35

/** The element with no landmark, form or dialog of its own belongs to the
 * page itself, which is the region an omission is reported against. */
const AGENT_PAGE_GROUP = "page"

type AgentOverviewFocus = AgentProjectionOptions["focus"]

/** A control matches a `find` query when the query appears in the name, role
 * or tag it shows — the fields the model has to recognise it by. */
const matchesQuery = (element: AgentElement, query: string): boolean => {
  const needle = query.toLowerCase()
  return (
    (element.name?.toLowerCase().includes(needle) ?? false) ||
    (element.role?.toLowerCase().includes(needle) ?? false) ||
    element.tag.toLowerCase().includes(needle)
  )
}

/**
 * How readily a control is kept when the page overflows the budget. Lower is
 * kept first: the focused control and anything the model asked to inspect or
 * find, then the controls a click could reach, then everything else — hidden,
 * covered, disabled or decorative. Priority decides what survives; document
 * order decides how the survivors read.
 */
const overviewPriority = (
  element: AgentElement,
  focus: AgentOverviewFocus
): number => {
  if (element.focused) return 0
  if (focus?.region !== undefined && element.group === focus.region) return 0
  if (focus?.query !== undefined && matchesQuery(element, focus.query)) return 0
  const reachable = element.visible && !element.occluded && element.enabled
  return reachable ? 1 : 2
}

const selectOverviewElements = (
  elements: readonly AgentElement[],
  budgetChars: number,
  ceilingChars: number,
  focus: AgentOverviewFocus
): {
  shown: AgentProjectedElement[]
  omittedByGroup: { group: string; count: number }[]
} => {
  const indexed = elements.map((element, index) => ({
    element,
    index,
    projected: projectAgentElement(element),
    priority: overviewPriority(element, focus)
  }))
  const ordered = [...indexed].sort((first, second) =>
    first.priority !== second.priority
      ? first.priority - second.priority
      : first.index - second.index
  )
  const kept = new Set<number>()
  let used = 0
  for (const item of ordered) {
    const cost = JSON.stringify(item.projected).length + 1
    /**
     * A focused control and a region the model asked to inspect are kept past
     * the overview budget — an inspect that still hid half the region would
     * defeat the point — but never past the hard ceiling, which is what keeps
     * the whole prompt inside the context window: a two-thousand-control
     * region cannot be shown whole if showing it would truncate the system
     * prompt. Everything else competes for the overview budget, and at least
     * one control is always kept so an overview is never empty.
     */
    const limit = item.priority === 0 ? ceilingChars : budgetChars
    if (kept.size > 0 && used + cost > limit) continue
    kept.add(item.index)
    used += cost
  }
  const shown = indexed
    .filter((item) => kept.has(item.index))
    .map((item) => item.projected)
  const omitted = new Map<string, number>()
  for (const item of indexed) {
    if (kept.has(item.index)) continue
    const group = item.element.group ?? AGENT_PAGE_GROUP
    omitted.set(group, (omitted.get(group) ?? 0) + 1)
  }
  const omittedByGroup = [...omitted.entries()]
    .map(([group, count]) => ({ group, count }))
    .sort((first, second) => second.count - first.count)
  return { shown, omittedByGroup }
}

export const projectAgentObservation = (
  observation: AgentObservation,
  options: AgentProjectionOptions = {}
): AgentProjectedObservation => {
  const base = {
    url: observation.url,
    title: observation.title,
    ...(observation.frames.length > 1
      ? {
          frames: observation.frames
            .slice(1)
            .map(({ frameId, origin, access }) => ({ frameId, origin, access }))
        }
      : {}),
    ...(observation.omittedFrames
      ? { omittedFrames: observation.omittedFrames }
      : {}),
    scroll: {
      y: Math.round(observation.scroll.y),
      ofDocument: Math.max(1, Math.round(observation.scroll.documentHeight))
    },
    ...(observation.modals?.length ? { modals: observation.modals } : {})
  }
  /**
   * No budget means the whole page travels, as it did before progressive
   * inspection: every control and the full text, including the below-fold
   * document text.
   */
  if (options.pageContentChars === undefined) {
    return {
      ...base,
      text: observation.visibleText,
      ...(observation.documentText
        ? { documentText: observation.documentText }
        : {}),
      ...(observation.documentTextTruncated
        ? { documentTextTruncated: true }
        : {}),
      elements: observation.elements.map(projectAgentElement)
    }
  }
  /**
   * A budgeted overview spends its characters on controls first and text
   * second, and reports what it dropped by region so the model can inspect a
   * region rather than conclude a control is gone. The below-fold document
   * text is left for an explicit `extract_text`, never carried by default —
   * it is the largest thing an overview could hold and the least often what
   * the next action needs.
   */
  const budget = Math.max(0, options.pageContentChars)
  const ceiling = Math.max(budget, options.pageContentMaxChars ?? budget)
  /**
   * An `extract_text` request is answered with the page's whole text — the
   * below-fold document included — rather than the budgeted excerpt, since
   * reading the page is the thing it asked for. It is still capped at the
   * ceiling, split between the viewport and the below-fold text, so even a
   * maximal page cannot push the prompt past the context window. Otherwise the
   * viewport text takes its overview share and yields the rest to controls.
   */
  const wantsText = options.focus?.text === true
  const textBudget = wantsText
    ? ceiling
    : Math.round(budget * AGENT_OVERVIEW_TEXT_SHARE)
  const text = observation.visibleText.slice(0, textBudget)
  /** Below-fold text fills only what the viewport text left under the ceiling. */
  const documentRoom = wantsText ? ceiling - text.length : 0
  const documentText =
    documentRoom > 0 && observation.documentText
      ? observation.documentText.slice(0, documentRoom)
      : undefined
  const documentTextTruncated =
    documentText !== undefined &&
    (observation.documentTextTruncated === true ||
      documentText.length < (observation.documentText?.length ?? 0))
  const { shown, omittedByGroup } = selectOverviewElements(
    observation.elements,
    budget - Math.min(text.length, budget),
    ceiling - Math.min(text.length, ceiling),
    options.focus
  )
  return {
    ...base,
    text,
    ...(text.length < observation.visibleText.length
      ? { textTruncated: true }
      : {}),
    ...(documentText !== undefined ? { documentText } : {}),
    ...(documentTextTruncated ? { documentTextTruncated: true } : {}),
    elements: shown,
    ...(omittedByGroup.length ? { omittedByGroup } : {})
  }
}
