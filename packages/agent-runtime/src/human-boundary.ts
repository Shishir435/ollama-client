import type { AgentObservation } from "@ollama-client/contracts"

const CREDENTIAL_SUBMIT =
  /^(?:sign in|sign on|log in|login|log on|continue|next|submit|verify|confirm|authenticate|enter|go|ok|sign up|create account)$/i
const SIGN_IN_PAGE =
  /(?:^|[^a-z])(?:sign[ _-]?in|sign[ _-]?on|log[ _-]?in|sso|auth(?:enticate|orize)?)(?:[^a-z]|$)/i

/** Detect rendered interaction gates, not prose mentioning login or CAPTCHA. */
export const agentObservationNeedsHuman = (
  observation: AgentObservation
): boolean => {
  const visible = observation.elements.filter((element) => element.visible)
  /**
   * A rendered password field is a credential gate when something on the
   * page offers to submit it — whatever that button says ("Submit", "Next",
   * "Verify") — or the page calls itself a sign-in. A password field on a page
   * the task only reads is not a gate, and pausing there would stall the read.
   */
  if (
    visible.some(
      (element) => element.type === "password" && element.enabled !== false
    ) &&
    (visible.some(
      (element) =>
        element.enabled !== false &&
        (element.tag === "button" ||
          element.role === "button" ||
          (element.tag === "input" &&
            ["submit", "button"].includes(element.type ?? ""))) &&
        CREDENTIAL_SUBMIT.test(element.name?.trim() ?? "")
    ) ||
      SIGN_IN_PAGE.test(observation.title) ||
      SIGN_IN_PAGE.test(observation.url ?? ""))
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
