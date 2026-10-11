import type { AgentObservation } from "@ollama-client/contracts"

/** Detect rendered interaction gates, not prose mentioning login or CAPTCHA. */
export const agentObservationNeedsHuman = (
  observation: AgentObservation
): boolean => {
  const visible = observation.elements.filter((element) => element.visible)
  if (
    visible.some((element) => element.type === "password") &&
    visible.some((element) =>
      /^(?:sign in|log in|login|continue|sign up|create account)$/i.test(
        element.name?.trim() ?? ""
      )
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
