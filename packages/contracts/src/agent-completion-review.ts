import { z } from "zod"
import {
  MAX_AGENT_CONSTRAINTS,
  MAX_AGENT_REQUIREMENT_ID_CHARS,
  MAX_AGENT_REQUIREMENTS
} from "./agent"

/**
 * What an independent reviewer may say about one planned outcome or limit.
 *
 * Three answers and no fourth: a reviewer cannot propose a new requirement,
 * soften one, or ask for an action. `insufficient_evidence` is the honest
 * answer to a claim the retained evidence neither proves nor disproves, and
 * the runtime treats it exactly like no review at all.
 */
export const AGENT_COMPLETION_REVIEW_VERDICTS = [
  "supported",
  "contradicted",
  "insufficient_evidence"
] as const

/** Ledger records one verdict may cite. More is a reviewer padding its case. */
export const MAX_AGENT_REVIEW_SOURCES = 3

export const AgentCompletionReviewVerdictSchema = z
  .object({
    /** The requirement or constraint id the reviewer was asked about. */
    id: z.string().min(1).max(MAX_AGENT_REQUIREMENT_ID_CHARS),
    verdict: z.enum(AGENT_COMPLETION_REVIEW_VERDICTS),
    /**
     * Evidence-ledger record ids, never quotations: the reviewer points at
     * what the runtime already grounded, and the runtime decides whether
     * that record can support this id.
     */
    sources: z
      .array(z.string().min(1).max(240))
      .max(MAX_AGENT_REVIEW_SOURCES)
      .default([])
  })
  .strict()
export type AgentCompletionReviewVerdict = z.infer<
  typeof AgentCompletionReviewVerdictSchema
>

export const AgentCompletionReviewSchema = z
  .object({
    verdicts: z
      .array(AgentCompletionReviewVerdictSchema)
      .max(MAX_AGENT_REQUIREMENTS + MAX_AGENT_CONSTRAINTS)
  })
  .strict()
export type AgentCompletionReview = z.infer<typeof AgentCompletionReviewSchema>
