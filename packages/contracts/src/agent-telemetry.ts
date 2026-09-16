import { z } from "zod"

/**
 * What one Agent step cost, in numbers only.
 *
 * Every gate the release is measured against — lower task time, fewer model
 * calls, no success regression — is a comparison against a baseline, and
 * there is no baseline without a record. The benchmark reported medians for
 * prompt and output tokens as `—` because nothing produced them: both
 * providers already emit usage on the stream chunk's `metrics`, and the
 * Agent's decision collector discarded every chunk field but errors and tool
 * calls.
 *
 * Durable on the step receipt rather than held in memory, because a run that
 * an MV3 worker restart interrupted is exactly the run worth measuring, and
 * the receipts are what survive it.
 *
 * Numbers only, and that is a privacy rule rather than a style one: a receipt
 * is read back into a prompt and exported by the debug report, so nothing
 * here may carry page text, a URL, or a model's words.
 */

const duration = z.number().int().nonnegative().max(86_400_000)
const count = z.number().int().nonnegative().max(100_000_000)

/**
 * Reported and estimated token counts are separate fields on purpose. An
 * estimate is `chars / 3.5` and is always available; a reported count comes
 * from the provider and is the only one worth gating on. Collapsing them into
 * one field would let an estimate be read as a measurement.
 */
export const AgentStepTelemetrySchema = z
  .object({
    /** Wall-clock the model took to answer, including malformed retries. */
    decideMs: duration.optional(),
    /** Wall-clock spent taking the decision's observation. */
    observeMs: duration.optional(),
    /** Wall-clock spent capturing and masking the screenshot, when one was taken. */
    captureMs: duration.optional(),
    /** Wall-clock spent grounding the decision against the live page. */
    resolveMs: duration.optional(),
    /** Wall-clock spent applying the effect. */
    executeMs: duration.optional(),
    /** Wall-clock spent verifying it, settle and wait polls included. */
    verifyMs: duration.optional(),
    /** Wall-clock spent writing the step and its run state. */
    persistMs: duration.optional(),
    /** From the request reaching the provider to its first streamed token. */
    firstTokenMs: duration.optional(),

    /** Provider-reported prompt tokens. Absent when the provider reported none. */
    promptTokens: count.optional(),
    /** Provider-reported generated tokens. */
    outputTokens: count.optional(),
    /** Our own `chars / 3.5` estimate, never a substitute for the above. */
    promptTokensEstimated: count.optional(),
    /** Characters actually serialized into the user message. */
    promptChars: count.optional(),

    /** Provider-reported model load time, when the runner reported one. */
    loadMs: duration.optional(),
    /** Provider-reported prompt evaluation time. */
    prefillMs: duration.optional(),
    /** Provider-reported generation time. */
    decodeMs: duration.optional(),

    /** The context window actually requested, so runner churn is visible. */
    numCtx: count.optional(),
    /** How many full observations this step cost, settle and wait included. */
    observations: count.optional(),
    /** Malformed-decision retries spent inside this step. */
    retries: count.optional(),
    /** Whether a screenshot travelled with the decision. */
    screenshot: z.boolean().optional()
  })
  .strict()

export type AgentStepTelemetry = z.infer<typeof AgentStepTelemetrySchema>

/** Nanoseconds as the Ollama runner reports them, rounded to whole milliseconds. */
export const agentTelemetryMillis = (
  nanoseconds: number | undefined
): number | undefined =>
  typeof nanoseconds === "number" &&
  Number.isFinite(nanoseconds) &&
  nanoseconds >= 0
    ? Math.round(nanoseconds / 1_000_000)
    : undefined

/**
 * Drops absent fields rather than writing `undefined` into a strict schema,
 * and returns nothing at all when a step measured nothing — an empty object
 * on every receipt would be bytes with no reader.
 */
export const agentStepTelemetry = (
  input: AgentStepTelemetry
): AgentStepTelemetry | undefined => {
  const entries = Object.entries(input).filter(
    ([, value]) => value !== undefined
  )
  return entries.length === 0
    ? undefined
    : AgentStepTelemetrySchema.parse(Object.fromEntries(entries))
}
