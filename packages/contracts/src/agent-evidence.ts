import { z } from "zod"

export const MAX_AGENT_LEDGER_RECORDS = 24
export const MAX_AGENT_LEDGER_BYTES = 12_000
export const MAX_AGENT_SOURCE_QUOTES = 3
export const MAX_AGENT_SOURCE_QUOTE_CHARS = 200

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
      "page_tool_claim"
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
    /** The verifier's exact kind, never a model's interpretation of it. */
    verificationKind: z.string().min(1).max(80).optional()
  })
  .strict()
  .superRefine((record, context) => {
    if (
      (record.kind === "observed_fact" && (!record.source || !record.quote)) ||
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
