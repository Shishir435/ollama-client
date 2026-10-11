import type { AgentObservation } from "@ollama-client/contracts"

const SIGN_IN_PAGE =
  /(?:^|[^a-z])(?:sign[ _-]?in|sign[ _-]?on|log[ _-]?in|sso|auth(?:enticate|orize)?)(?:[^a-z]|$)/i

type ObservedElement = AgentObservation["elements"][number]

/**
 * Any rendered control that submits the form — whatever it says, in
 * whatever language. Binding it to the password's own form is what makes it
 * evidence; its label is not.
 */
const submitsForm = (element: ObservedElement): boolean =>
  element.submitter === true ||
  (element.tag === "input" && element.type === "submit") ||
  (element.tag === "button" && (element.type ?? "submit") === "submit")

const NON_TEXT_INPUTS = new Set([
  "hidden",
  "checkbox",
  "radio",
  "submit",
  "button",
  "password"
])

/**
 * Whether this password field is a sign-in rather than an optional password
 * form among other settings. A sign-in form holds one password and at most a
 * username beside it, and its own submit control offers to send them; a
 * change-password form carries current, new and confirm fields, and a
 * settings form many more. A button elsewhere on the page proves nothing.
 */
const isSignInField = (
  field: ObservedElement,
  observation: AgentObservation,
  signInPage: boolean
): boolean => {
  const form = field.formFingerprint
  if (!form) return signInPage
  /** Hidden or disabled controls and other frames are not part of what the user sees. */
  const inForm = observation.elements.filter(
    (element) =>
      element.formFingerprint === form &&
      element.frameId === field.frameId &&
      element.visible &&
      element.enabled !== false
  )
  if (inForm.filter((element) => element.type === "password").length !== 1)
    return false
  const otherFields = inForm.filter(
    (element) =>
      element.editable &&
      element.tag !== "button" &&
      !NON_TEXT_INPUTS.has(element.type ?? "")
  )
  if (otherFields.length > 2) return false
  return signInPage || inForm.some(submitsForm)
}

/** Detect rendered interaction gates, not prose mentioning login or CAPTCHA. */
export const agentObservationNeedsHuman = (
  observation: AgentObservation
): boolean => {
  const visible = observation.elements.filter((element) => element.visible)
  const signInPage =
    SIGN_IN_PAGE.test(observation.title) ||
    SIGN_IN_PAGE.test(observation.url ?? "")
  if (
    visible.some(
      (element) =>
        element.type === "password" &&
        element.enabled !== false &&
        isSignInField(element, observation, signInPage)
    )
  )
    return true
  if (
    visible.some((element) =>
      /^(?:i'm not a robot|i am not a robot|verify (?:you are|that you are) human|complete the captcha)$/i.test(
        element.name?.trim() ?? ""
      )
    )
  )
    return true
  return (
    /^(?:just a moment(?:\.\.\.)?|security verification|verify you are human|attention required!?)/i.test(
      observation.title.trim()
    ) &&
    /\b(?:captcha|verify|human|security check|checking your browser)\b/i.test(
      observation.visibleText
    )
  )
}
