import type {
  AgentCommand,
  AgentElement,
  AgentObservation
} from "@ollama-client/contracts"

/**
 * Whether an observed control accepts the command aimed at it, decided from
 * the observation alone.
 *
 * The trusted resolver already refused a command its target could not accept,
 * but it runs after the decision has been accepted, so the answer arrived as a
 * failed run rather than as a correction. The same question asked at parse
 * time costs a retry instead, which is the difference between a model that
 * learns a checkbox is not a button and a run that ends because it guessed.
 *
 * Two callers therefore ask it, and both must get the same answer: a rule that
 * lived twice would let the parser accept what execution refuses, which is the
 * worst of the three possible arrangements.
 */
export const AGENT_AFFORDANCE_REASONS = [
  "unknown_ref",
  "ambiguous_ref",
  "hidden_target",
  "disabled_target",
  "not_text_field",
  "not_select",
  "option_unavailable",
  "not_checkable",
  "radio_uncheck",
  "not_clickable",
  "use_check_instead",
  "use_click_instead",
  "image_submit",
  "not_focused"
] as const
export type AgentAffordanceReason = (typeof AGENT_AFFORDANCE_REASONS)[number]

/**
 * A refusal carries structure and nothing else. An accessible name or a value
 * is content, and content must never travel back into a prompt as something
 * the page got to write.
 *
 * Tag, role and input type look structural, but only the tag actually is:
 * `role` is whatever the page put in its attribute, and several elements
 * reflect an arbitrary `type` attribute too. Unbounded and unfiltered, either
 * would carry a sentence into the next prompt labelled as the agent's own
 * refusal — worse than page text labelled as page text. They are therefore
 * reported only when they name something this vocabulary already knows.
 */
export interface AgentAffordanceRefusal {
  reason: AgentAffordanceReason
  ref?: string
  tag?: string
  role?: string
  inputType?: string
}

/**
 * The roles this vocabulary can name. Not the whole ARIA set: a role only has
 * to survive the filter if the agent's reasoning or its feedback says
 * something about it. Anything else is dropped and the refusal describes the
 * element by its tag alone.
 */
const REPORTABLE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "dialog",
  "gridcell",
  "img",
  "link",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem"
])

/** Every type keyword an interactive control can legitimately report. */
const REPORTABLE_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "date",
  "datetime-local",
  "email",
  "file",
  "hidden",
  "image",
  "month",
  "number",
  "password",
  "radio",
  "range",
  "reset",
  "search",
  "select-multiple",
  "select-one",
  "submit",
  "tel",
  "text",
  "textarea",
  "time",
  "url",
  "week"
])

const reportable = (
  value: string | undefined,
  vocabulary: Set<string>
): string | undefined => {
  const token = value?.toLowerCase()
  return token && vocabulary.has(token) ? token : undefined
}

const TEXT_INPUT_TYPES = ["email", "number", "search", "tel", "text", "url"]
const CLICKABLE_INPUT_TYPES = ["button", "image", "reset", "submit"]
/**
 * Widget roles a pointer activates. Custom dropdowns, tab strips and tree
 * views are built from these rather than from `<button>`, and a model told it
 * may only click buttons has no way to open the listbox it can see.
 */
const CLICKABLE_ROLES = [
  "button",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "combobox",
  "option",
  "tab",
  "treeitem",
  "switch",
  "gridcell",
  "listbox"
]

const refusal = (
  reason: AgentAffordanceReason,
  element?: AgentElement,
  ref?: string
): AgentAffordanceRefusal => {
  const role = reportable(element?.role, REPORTABLE_ROLES)
  const type = reportable(element?.type, REPORTABLE_INPUT_TYPES)
  return {
    reason,
    ...((ref ?? element?.ref) ? { ref: ref ?? element?.ref } : {}),
    ...(element?.tag ? { tag: element.tag } : {}),
    ...(role ? { role } : {}),
    ...(type ? { inputType: type } : {})
  }
}

const inputType = (element: AgentElement): string =>
  element.type?.toLowerCase() ?? ""

const acceptsText = (element: AgentElement): boolean => {
  if (
    element.sensitive &&
    (element.tag === "input" || element.tag === "textarea") &&
    element.editable
  ) {
    return true
  }
  const supportedInput =
    element.tag === "input" &&
    TEXT_INPUT_TYPES.includes(element.type?.toLowerCase() ?? "text")
  return (supportedInput || element.tag === "textarea") && element.editable
}

const isClickable = (element: AgentElement): boolean =>
  element.tag === "button" ||
  (element.tag === "input" &&
    CLICKABLE_INPUT_TYPES.includes(inputType(element))) ||
  CLICKABLE_ROLES.includes(element.role?.toLowerCase() ?? "")

const isCheckable = (element: AgentElement): boolean =>
  element.tag === "input" && ["checkbox", "radio"].includes(inputType(element))

/**
 * A checkbox is refused to both pointer gestures, because `check` and
 * `uncheck` state the intended value and can therefore be verified, while a
 * click states a toggle. Saying so is the point: told to click a button
 * instead, a model has no way to reach the box it can see.
 */
const classifyClick = (
  element: AgentElement
): AgentAffordanceRefusal | undefined => {
  if (element.tag === "input" && inputType(element) === "image") {
    return refusal("image_submit", element)
  }
  if (isCheckable(element)) return refusal("use_check_instead", element)
  /** A rendered destination is activation enough, whatever the tag is. */
  return element.href || isClickable(element)
    ? undefined
    : refusal("not_clickable", element)
}

/**
 * A link or a submitter acts on the first click; the second would land on
 * whatever page replaced it. `click` carries the guarded navigation and
 * submission paths, so it is the one to use.
 */
const classifyDoubleClick = (
  element: AgentElement
): AgentAffordanceRefusal | undefined => {
  if (isCheckable(element)) return refusal("use_check_instead", element)
  return element.href || element.submitter
    ? refusal("use_click_instead", element)
    : undefined
}

const classifyTarget = (
  command: AgentCommand,
  element: AgentElement
): AgentAffordanceRefusal | undefined => {
  switch (command.type) {
    case "click":
      return classifyClick(element)
    case "double_click":
      return classifyDoubleClick(element)
    case "hover":
      return undefined
    case "type":
    case "clear_and_type":
      return acceptsText(element)
        ? undefined
        : refusal("not_text_field", element)
    case "select": {
      if (element.tag !== "select" || !element.editable || !element.options) {
        return refusal("not_select", element)
      }
      const matches = element.options.filter(
        (option) => option.value === command.value && !option.disabled
      )
      return matches.length === 1
        ? undefined
        : refusal("option_unavailable", element)
    }
    case "check":
    case "uncheck": {
      const type = inputType(element)
      if (element.tag !== "input" || !["checkbox", "radio"].includes(type)) {
        return refusal("not_checkable", element)
      }
      return command.type === "uncheck" && type === "radio"
        ? refusal("radio_uncheck", element)
        : undefined
    }
    case "press_key":
      return element.focused ? undefined : refusal("not_focused", element)
    default:
      return undefined
  }
}

/**
 * `undefined` means the observation supports the command. A command with no
 * ref is not this function's business: only the resolver knows whether a
 * destination or a tab is reachable.
 */
export const classifyAgentAffordance = (
  command: AgentCommand,
  observation: AgentObservation
): AgentAffordanceRefusal | undefined => {
  if (!("ref" in command) || command.ref === undefined) return undefined
  /**
   * References are unique across frames — a child frame's carry its frame in
   * their prefix — so the ref alone names the element and the frame it is in.
   */
  const candidates = observation.elements.filter(
    (element) => element.ref === command.ref
  )
  if (candidates.length === 0)
    return { reason: "unknown_ref", ref: command.ref }
  if (candidates.length > 1)
    return { reason: "ambiguous_ref", ref: command.ref }
  const element = candidates[0]
  if (!element.visible) return refusal("hidden_target", element)
  /** A pointer may rest on a disabled control — that is how its tooltip shows. */
  if (command.type === "hover") return undefined
  if (!element.enabled) return refusal("disabled_target", element)
  /** A scroll only needs a real element; it changes nothing about it. */
  return command.type === "scroll"
    ? undefined
    : classifyTarget(command, element)
}

/**
 * Filtered again here, not only where the refusal was built: this function is
 * exported, so a caller that assembled a refusal by hand would otherwise
 * decide for itself what reaches a prompt. The guarantee has to hold wherever
 * the sentence is produced.
 */
const described = (refused: AgentAffordanceRefusal): string => {
  const role = reportable(refused.role, REPORTABLE_ROLES)
  const type = reportable(refused.inputType, REPORTABLE_INPUT_TYPES)
  const parts = [refused.tag ? `<${refused.tag}>` : "the element"]
  if (type) parts.push(`of type "${type}"`)
  if (role) parts.push(`with role "${role}"`)
  return parts.join(" ")
}

/**
 * What the next attempt is told. Assembled from templates, the ref the model
 * itself supplied, and the structural facts above — never from a string the
 * page chose, because this text is about to become part of a prompt.
 */
export const agentAffordanceFeedback = (
  refused: AgentAffordanceRefusal
): string => {
  const ref = refused.ref ? `Ref "${refused.ref}"` : "That element"
  switch (refused.reason) {
    case "unknown_ref":
      return `${ref} is not in the current observation. Use a ref that the observation lists.`
    case "ambiguous_ref":
      return `${ref} matches more than one observed element. Pick a different ref.`
    case "hidden_target":
      return `${ref} is not visible, so it cannot be acted on. Choose a visible element, or scroll first.`
    case "disabled_target":
      return `${ref} is disabled. Choose an enabled element, or do what the page needs to enable it.`
    case "not_text_field":
      return `${ref} is ${described(refused)} and does not accept typed text. Type only into a text input or a textarea.`
    case "not_select":
      return `${ref} is ${described(refused)} and is not a dropdown. Use select only on a <select> element.`
    case "option_unavailable":
      return `${ref} has no enabled option with that exact value. Use one of the option values the observation lists for it.`
    case "not_checkable":
      return `${ref} is ${described(refused)}. Use check or uncheck only on a checkbox or radio input; click activates a button.`
    case "radio_uncheck":
      return `${ref} is a radio button, which cannot be unchecked. Check a different option in its group instead.`
    case "not_clickable":
      return `${ref} is ${described(refused)} and is not an activatable control. Click a button, a link or a menuitem.`
    case "use_check_instead":
      return `${ref} is a ${refused.inputType === "radio" ? "radio button" : "checkbox"}. Use check or uncheck on it rather than click, so the intended value is stated.`
    case "use_click_instead":
      return `${ref} is ${refused.tag === "a" ? "a link" : "a submit control"}. Use click on it; a double click would act on the page it leaves.`
    case "image_submit":
      return `${ref} is an image submit control, which this agent cannot activate. Use a different control.`
    case "not_focused":
      return `${ref} is not focused, so a key press would not reach it. Click or type into it first.`
  }
}

/**
 * A command the trusted resolver refused before attempting anything.
 *
 * It is deliberately distinct from a verification failure: nothing was done to
 * the page, so the run has not lost track of anything, and reporting it as
 * "the effect could not be verified" told the user the opposite of the truth.
 */
export class AgentGroundingError extends Error {
  readonly refusal?: AgentAffordanceRefusal

  constructor(input: { refusal?: AgentAffordanceRefusal; message?: string }) {
    super(
      input.message ??
        (input.refusal
          ? agentAffordanceFeedback(input.refusal)
          : "The proposed page effect could not be grounded in the observed page.")
    )
    this.name = "AgentGroundingError"
    if (input.refusal) this.refusal = input.refusal
  }
}

/** The run-visible sentence for a command that never reached the page. */
export const agentGroundingMessage = (error: unknown): string =>
  error instanceof AgentGroundingError && error.refusal
    ? agentAffordanceFeedback(error.refusal)
    : "The proposed page effect could not be grounded in the observed page."
