/**
 * What a confirmed click did, named by the verifier that saw it.
 *
 * A followed link is verified as an `activation`, and so is a click that
 * stayed put, and consumers need to tell them apart. They used to do it by
 * matching the verifier's own sentence, which made a reworded summary change
 * what a run counted as having left the page — and left the sentences the
 * matching set never listed, a router navigating the tab itself among them,
 * counted as having stayed. The code is the contract; the summary is for a
 * person to read.
 */
export const AGENT_EVIDENCE_CODES = [
  "destination_committed",
  "same_origin_redirect",
  "opened_new_tab",
  "page_navigated_itself",
  "page_handled_link"
] as const
export type AgentEvidenceCode = (typeof AGENT_EVIDENCE_CODES)[number]

/**
 * The sentences receipts carried before the code existed. Read only to give a
 * receipt written by an earlier version the code it would have had; nothing
 * new is added here, since a new verdict gets a code instead.
 */
const LEGACY_SUMMARY_CODES: Readonly<Record<string, AgentEvidenceCode>> = {
  "Authorized destination is committed": "destination_committed",
  "The site redirected its own link within its origin": "same_origin_redirect",
  "Control opened a new tab": "opened_new_tab"
}

/** The code a piece of evidence carries, or the one its older wording implies. */
export const agentEvidenceCode = (evidence: {
  code?: AgentEvidenceCode
  summary: string
}): AgentEvidenceCode | undefined =>
  evidence.code ?? LEGACY_SUMMARY_CODES[evidence.summary]

/**
 * A confirmed click that took the run to another page, or opened one: a link
 * followed, a router that moved the tab itself, a destination that committed.
 * A tab the click opened is here because it is a destination reached; callers
 * that care which kind ask for `opened_new_tab` as well.
 */
export const AGENT_PAGE_LEAVING_CODES: ReadonlySet<AgentEvidenceCode> = new Set(
  [
    "destination_committed",
    "same_origin_redirect",
    "opened_new_tab",
    "page_navigated_itself"
  ]
)

/** Whether this evidence says the click opened its page in a tab of its own. */
export const agentEvidenceOpenedTab = (evidence: {
  code?: AgentEvidenceCode
  summary: string
}): boolean => agentEvidenceCode(evidence) === "opened_new_tab"

/** Whether this evidence says the click led somewhere, in this tab or another. */
export const agentEvidenceLeftPage = (evidence: {
  code?: AgentEvidenceCode
  summary: string
}): boolean => {
  const code = agentEvidenceCode(evidence)
  return code !== undefined && AGENT_PAGE_LEAVING_CODES.has(code)
}
