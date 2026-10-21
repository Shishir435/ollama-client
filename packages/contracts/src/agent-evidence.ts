import { z } from "zod"
import {
  MAX_AGENT_REQUIREMENT_CHARS,
  MAX_AGENT_REQUIREMENT_ITEM_LINK_CHARS
} from "./agent-task-limits"

export const MAX_AGENT_LEDGER_RECORDS = 24
export const MAX_AGENT_LEDGER_BYTES = 12_000
/**
 * Quotes one decision may retain. A comparison of four sources completes
 * with four lines, and three refused the whole decision as malformed until
 * the run ran out of tries; the ledger's own record cap still bounds them.
 */
export const MAX_AGENT_SOURCE_QUOTES = 8
export const MAX_AGENT_SOURCE_QUOTE_CHARS = 200
/** How much of a page's opening text is read for the items it names. */
export const MAX_AGENT_EVIDENCE_LEAD_CHARS = 80
/** The most plan items one retained fact records its page as naming. */
export const MAX_AGENT_EVIDENCE_PAGE_ITEMS = 8

/** A model proposes a quotation; only the runtime can turn it into evidence. */
export const AgentSourceQuoteSchema = z
  .object({
    quote: z.string().min(1).max(MAX_AGENT_SOURCE_QUOTE_CHARS),
    ref: z.string().min(1).max(40).optional(),
    frameId: z.number().int().nonnegative().optional(),
    requirementId: z.string().min(1).max(8).optional()
  })
  .strict()
export const AgentSourceQuotesSchema = z
  .array(AgentSourceQuoteSchema)
  .max(MAX_AGENT_SOURCE_QUOTES)
export type AgentSourceQuote = z.infer<typeof AgentSourceQuoteSchema>

export const AgentEvidenceSourceSchema = z
  .object({
    tabId: z.number().int().nonnegative(),
    frameId: z.number().int().nonnegative(),
    documentId: z.string().min(1).max(200),
    snapshotId: z.string().min(1).max(200),
    generation: z.number().int().nonnegative(),
    /** Origin only: paths, queries and fragments can contain private values. */
    origin: z
      .string()
      .max(300)
      .regex(/^https?:\/\/[^/@?#\s]+(?::\d+)?$/)
  })
  .strict()

export const AgentEvidenceRecordSchema = z
  .object({
    id: z.string().min(1).max(240),
    kind: z.enum([
      "observed_fact",
      "verified_effect",
      "user_input",
      "agent_input",
      "model_inference",
      "page_tool_claim",
      /**
       * What the model read off a screenshot it was shown, bound to that
       * picture's snapshot. The quote is the model's reading, not page text,
       * and the image itself is never kept: it can settle a read requirement
       * only as one seen in a screenshot, and never proves a change.
       */
      "visual_observation"
    ]),
    validity: z.enum([
      "current",
      "historical",
      "superseded",
      "incomplete",
      "requires_refresh"
    ]),
    source: AgentEvidenceSourceSchema.optional(),
    observedAt: z.number().int().nonnegative(),
    requirementId: z.string().min(1).max(8).optional(),
    /** A bounded approved quotation, never a form value or a complete page. */
    quote: z.string().min(1).max(MAX_AGENT_SOURCE_QUOTE_CHARS).optional(),
    /**
     * The plan's read items the page's opening text named when this fact
     * was read, so a line that names no item — "Blue Kettle 41 credits" —
     * can still be told to be Kettle Corner's by the heading it sat under.
     * The plan's own words, never more of the page than the quote.
     */
    pageItems: z
      .array(z.string().min(1).max(MAX_AGENT_REQUIREMENT_CHARS))
      .min(1)
      .max(MAX_AGENT_EVIDENCE_PAGE_ITEMS)
      .optional(),
    /** The verifier's exact kind, never a model's interpretation of it. */
    verificationKind: z.string().min(1).max(80).optional(),
    /**
     * Where a verified `open_tab` went, origin and path only, as the step's
     * own receipt keeps it. Without it a tab receipt says a tab opened and
     * not which page, so "open every source link" could not be matched to
     * the links it owed.
     */
    destination: z
      .string()
      .min(1)
      .max(MAX_AGENT_REQUIREMENT_ITEM_LINK_CHARS)
      .optional()
  })
  .strict()
  .superRefine((record, context) => {
    if (
      ((record.kind === "observed_fact" ||
        record.kind === "visual_observation") &&
        (!record.source || !record.quote)) ||
      (record.kind === "verified_effect" &&
        (!record.source || !record.verificationKind))
    ) {
      context.addIssue({
        code: "custom",
        message: "Grounded records require their source and support"
      })
    }
  })
export const AgentEvidenceLedgerSchema = z
  .array(AgentEvidenceRecordSchema)
  .max(MAX_AGENT_LEDGER_RECORDS)
export type AgentEvidenceRecord = z.infer<typeof AgentEvidenceRecordSchema>
