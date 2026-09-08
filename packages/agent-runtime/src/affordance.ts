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
  "image_submit",
  "not_focused"
] as const
export type AgentAffordanceReason = (typeof AGENT_AFFORDANCE_REASONS)[number]

/**
 * A refusal carries structure and nothing else. Tag, role and input type are
 * facts about the document's shape; an accessible name, a value or any page
 * string is content, and content is what must never travel back into a prompt
 * as an instruction the page got to write.
 */
export interface AgentAffordanceRefusal {
  reason: AgentAffordanceReason
  ref?: string
  tag?: string
  role?: string
  inputType?: string
}

const TEXT_INPUT_TYPES = ["email", "number", "search", "tel", "text", "url"]
const CLICKABLE_INPUT_TYPES = ["button", "image", "reset", "submit"]
const CLICKABLE_ROLES = ["button", "link", "menuitem"]

const refusal = (
  reason: AgentAffordanceReason,
  element?: AgentElement,
  ref?: string
): AgentAffordanceRefusal => ({
  reason,
  ...((ref ?? element?.ref) ? { ref: ref ?? element?.ref } : {}),
  ...(element?.tag ? { tag: element.tag } : {}),
  ...(element?.role ? { role: element.role } : {}),
  ...(element?.type ? { inputType: element.type } : {})
})

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

const classifyTarget = (
  command: AgentCommand,
  element: AgentElement
): AgentAffordanceRefusal | undefined => {
  switch (command.type) {
    case "click":
      if (element.tag === "input" && inputType(element) === "image") {
        return refusal("image_submit", element)
      }
      /**
       * A checkbox is refused, because `check` and `uncheck` state the
       * intended value and can therefore be verified, while a click states a
       * toggle. Saying so is the point: told to click a button instead, a
       * model has no way to reach the box it can see.
       */
      if (
        element.tag === "input" &&
        ["checkbox", "radio"].includes(inputType(element))
      ) {
        return refusal("use_check_instead", element)
      }
      /** A rendered destination is activation enough, whatever the tag is. */
      return element.href || isClickable(element)
        ? undefined
        : refusal("not_clickable", element)
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
  const candidates = observation.elements.filter(
    (element) => element.ref === command.ref && element.frameId === 0
  )
  if (candidates.length === 0)
    return { reason: "unknown_ref", ref: command.ref }
  if (candidates.length > 1)
    return { reason: "ambiguous_ref", ref: command.ref }
  const element = candidates[0]
  if (!element.visible) return refusal("hidden_target", element)
  if (!element.enabled) return refusal("disabled_target", element)
  /** A scroll only needs a real element; it changes nothing about it. */
  return command.type === "scroll"
    ? undefined
    : classifyTarget(command, element)
}

const described = (refused: AgentAffordanceRefusal): string => {
  const parts = [refused.tag ? `<${refused.tag}>` : "the element"]
  if (refused.inputType) parts.push(`of type "${refused.inputType}"`)
  if (refused.role) parts.push(`with role "${refused.role}"`)
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
