import type {
  AgentCommand,
  AgentObservation,
  AgentRunState
} from "@ollama-client/contracts"

/**
 * Scheme and host, lowercased, default port dropped. The package has no DOM
 * `URL`; an address this cannot read is left to the resolver, which refuses
 * what it cannot parse.
 */
const originOf = (url: string): string | undefined => {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)/i.exec(url)
  if (!match) return undefined
  const scheme = match[1].toLowerCase()
  const host = match[2]
    .toLowerCase()
    .replace(
      scheme === "https" ? /:443$/ : scheme === "http" ? /:80$/ : /$^/,
      ""
    )
  return `${scheme}://${host}`
}

/**
 * A run never navigates the user's own tab to another site.
 *
 * The tab a run starts on is the page the user was looking at. Given the
 * same goal twice, a model opened the site in a new tab once and navigated
 * the user's tab away from their page the next time; which one happened was
 * the model's coin toss. Leaving for another origin from that tab is an
 * `open_tab` instead — the same destination, the same approval, the page the
 * user was on left where it was. Same-origin navigation, and anything in a
 * tab the run opened itself, are unchanged.
 */
export const agentCommandKeepingUserTab = (
  command: AgentCommand,
  state: Pick<AgentRunState, "controlledTabId" | "scopedTabIds">,
  observation: Pick<AgentObservation, "origin">
): AgentCommand => {
  if (command.type !== "navigate") return command
  /** The run's scope starts as the user's tab; tabs it opens join after. */
  const userTab = state.scopedTabIds?.[0] ?? state.controlledTabId
  if (state.controlledTabId !== userTab) return command
  const origin = originOf(command.url)
  if (origin === undefined || origin === originOf(observation.origin))
    return command
  return { ...command, type: "open_tab" }
}
