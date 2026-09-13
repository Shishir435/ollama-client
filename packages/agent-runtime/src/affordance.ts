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
  "not_scrollable",
  "unavailable_frame",
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
  "not_focused",
  /** Editing: the text a command names is not there, or the field cannot hold it. */
  "newline_in_single_line",
  "text_not_found",
  "text_ambiguous",
  "value_truncated",
  /** Drag: the destination cannot be grounded beside the source. */
  "unknown_destination",
  "hidden_destination",
  "cross_frame_drag",
  "drag_onto_itself",
  /**
   * Native dialogs: the page is blocked by one, or an answer names a prompt
   * that is not the one open.
   */
  "dialog_open",
  "unknown_dialog",
  "prompt_text_unsupported",
  /** Visual grounding: a point that cannot be turned into a control. */
  "no_screenshot",
  "point_outside_image",
  "visual_unavailable",
  "point_on_nothing",
  "point_in_frame"
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
  "contenteditable",
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

/** An editing host: a rich-text editor's document, or a bare editable region. */
const isEditor = (element: AgentElement): boolean =>
  element.editable && inputType(element) === "contenteditable"

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
  return (
    (supportedInput || element.tag === "textarea" || isEditor(element)) &&
    element.editable
  )
}

const containsNewline = (text: string): boolean => /[\r\n]/.test(text)

/**
 * Typed text may hold a line break only where the field can hold one. In a
 * single-line field the break would stand for Enter — and Enter is a
 * completion signal, submitting a form or sending a message, that the model
 * has to press on purpose through `press_key` so policy sees it as one.
 */
const classifyTypedText = (
  element: AgentElement,
  text: string
): AgentAffordanceRefusal | undefined => {
  if (!acceptsText(element)) return refusal("not_text_field", element)
  if (element.valueTruncated) return refusal("value_truncated", element)
  if (containsNewline(text) && !element.multiline) {
    return refusal("newline_in_single_line", element)
  }
  return undefined
}

const countOccurrences = (value: string, find: string): number => {
  let count = 0
  let from = 0
  for (;;) {
    const index = value.indexOf(find, from)
    if (index < 0) return count
    count += 1
    from = index + find.length
  }
}

/**
 * An in-place edit is grounded in the value the model read: the text it
 * names has to be there, once. A sensitive field shows no value, so nothing
 * is checked here — policy sends the whole step to the user anyway.
 */
const classifyReplacement = (
  element: AgentElement,
  command: Extract<AgentCommand, { type: "replace_text" }>
): AgentAffordanceRefusal | undefined => {
  const typed = classifyTypedText(element, command.text)
  if (typed) return typed
  if (element.sensitive) return undefined
  const occurrences = countOccurrences(element.value ?? "", command.find)
  if (occurrences === 0) return refusal("text_not_found", element)
  return occurrences > 1 ? refusal("text_ambiguous", element) : undefined
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
  /**
   * A file input opens the browser's chooser, which is the user's to answer;
   * the click is accepted here so policy can hand the step over rather than
   * the model being told the control does not exist.
   */
  if (element.tag === "input" && inputType(element) === "file") return undefined
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
      return classifyTypedText(element, command.text)
    case "replace_text":
      return classifyReplacement(element, command)
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
 * What an open native dialog allows.
 *
 * A dialog holds the document itself: script does not run, so nothing in the
 * page can be read or acted on until it is answered. Every other command is
 * therefore refused while one is open, and the answer has to name the dialog
 * it was decided against — the page can close one and open another between an
 * observation and the answer, and an answer that named no prompt would
 * confirm whichever prompt happened to be open.
 */
const classifyDialogState = (
  command: AgentCommand,
  observation: AgentObservation
): AgentAffordanceRefusal | undefined => {
  if (command.type !== "handle_dialog") {
    return observation.dialogs.length > 0
      ? { reason: "dialog_open" }
      : undefined
  }
  const dialog = observation.dialogs.find(
    (open) => open.id === command.dialogId
  )
  if (!dialog) return { reason: "unknown_dialog" }
  return command.promptText !== undefined && dialog.type !== "prompt"
    ? { reason: "prompt_text_unsupported" }
    : undefined
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
  const blocked = classifyDialogState(command, observation)
  if (blocked) return blocked
  if (
    command.type === "extract_text" &&
    command.frameId !== undefined &&
    command.frameId !== 0 &&
    !observation.frames.some(
      (frame) =>
        frame.frameId === command.frameId &&
        (frame.access === "ok" || frame.access === "element_budget")
    )
  )
    return { reason: "unavailable_frame" }
  if (command.type === "scroll" && command.container && !command.ref)
    return { reason: "not_scrollable" }
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
  if (command.type === "scroll" && !command.container) return undefined
  if (!element.visible) return refusal("hidden_target", element)
  /** A pointer may rest on a disabled control — that is how its tooltip shows. */
  if (command.type === "hover") return undefined
  if (!element.enabled) return refusal("disabled_target", element)
  /** A scroll only needs a real element; it changes nothing about it. */
  if (command.type === "scroll") {
    if (
      command.container &&
      (!command.ref ||
        !observation.elements.find((element) => element.ref === command.ref)
          ?.scroll)
    )
      return {
        reason: "not_scrollable",
        ...(command.ref ? { ref: command.ref } : {})
      }
    return undefined
  }
  if (command.type === "drag")
    return classifyDrag(command, element, observation)
  return classifyTarget(command, element)
}

/**
 * A drag is grounded twice. The destination has to be an element the
 * observation lists and shows — a drop on a hidden element is a drop on
 * nothing — and it has to share the source's frame, because one pointer
 * gesture cannot cross documents. Nothing is said about whether the source
 * can be dragged: pointer-based libraries mark nothing, so the verifier
 * answers that from the page's own arrangement afterwards.
 */
const classifyDrag = (
  command: Extract<AgentCommand, { type: "drag" }>,
  source: AgentElement,
  observation: AgentObservation
): AgentAffordanceRefusal | undefined => {
  if (command.to === command.ref) return refusal("drag_onto_itself", source)
  const destinations = observation.elements.filter(
    (element) => element.ref === command.to
  )
  if (destinations.length !== 1) {
    return { reason: "unknown_destination", ref: command.to }
  }
  const destination = destinations[0]
  if (!destination.visible) return refusal("hidden_destination", destination)
  if (destination.frameId !== source.frameId) {
    return refusal("cross_frame_drag", destination)
  }
  return undefined
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
    case "not_scrollable":
      return `${ref} is not an observed scrollable pane. Choose a ref with scroll metrics, or omit container to bring a target into view.`
    case "unavailable_frame":
      return "The requested frame is not available to this run. Choose an authorized frame from observation.frames, or ask the user for help."
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
    case "newline_in_single_line":
      return `${ref} is a single-line field, so typed text cannot contain a line break. Type the text without it; to confirm or send, use press_key with Enter on the focused field.`
    case "text_not_found":
      return `${ref} does not contain the text named in find. Use an exact run of its observed value.`
    case "text_ambiguous":
      return `${ref} contains the text named in find more than once. Name a longer run that occurs exactly once.`
    case "value_truncated":
      return `${ref} exceeds the editable text limit and its value is truncated. Ask the user to edit this field; changing only the observed prefix could discard unseen text.`
    case "unknown_destination":
      return `${ref} is not in the current observation, so nothing can be dragged onto it. Use a destination ref the observation lists.`
    case "hidden_destination":
      return `${ref} is not visible, so nothing can be dropped on it. Choose a visible destination, or scroll first.`
    case "cross_frame_drag":
      return `${ref} is in a different frame from the dragged element. A drag stays within one frame; choose a destination in the same frame.`
    case "drag_onto_itself":
      return `${ref} is both the dragged element and the destination. Name a different element to drop it on.`
    case "no_screenshot":
      return `${ref} cannot be grounded by a point: no screenshot was attached to this observation. Use an element ref from the observation.`
    case "point_outside_image":
      return `${ref} names a point outside the attached screenshot. Coordinates are pixels of the image, x from its left edge and y from its top edge.`
    case "visual_unavailable":
      return `${ref} cannot be reached by a point: visual clicks are not available on this page. Use an element ref from the observation.`
    case "point_on_nothing":
      return `${ref} names a point with nothing under it. Choose a point on a visible control, or use an element ref.`
    case "point_in_frame":
      return `${ref} names a point inside an embedded frame. Use the frame's own refs, which carry the frame in their prefix.`
    case "dialog_open":
      return "A dialog the page opened is holding it, so nothing on the page can be read or acted on. Answer it with handle_dialog, naming the dialogId the observation lists; accept false dismisses it."
    case "unknown_dialog":
      return "No dialog with that dialogId is open. Use the dialogId the current observation lists, or act on the page if it lists none."
    case "prompt_text_unsupported":
      return "promptText belongs to a prompt dialog only. Answer this dialog with accept alone."
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
