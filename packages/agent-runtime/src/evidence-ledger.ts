import {
  type AgentDecision,
  type AgentEvidenceRecord,
  AgentEvidenceRecordSchema,
  AgentEvidenceSourceSchema,
  type AgentObservation,
  type AgentRunState,
  type AgentScreenshot,
  type AgentSourceQuote,
  MAX_AGENT_LEDGER_BYTES,
  MAX_AGENT_LEDGER_RECORDS,
  MAX_AGENT_SOURCE_QUOTE_CHARS
} from "@ollama-client/contracts"
import { groundedCompletionQuote } from "./completion-support"
import { agentNormalizedClaim } from "./observed-text"
import type {
  AgentStepReadout,
  AgentVerificationResult,
  ResolvedAgentEffect
} from "./ports"
import { agentAuthoredText } from "./provenance"

/** No page URL or field value enters this source projection. */
export const agentEvidenceSource = (
  observation: AgentObservation,
  frameId: number
) => {
  const frame = observation.frames.find((item) => item.frameId === frameId)
  if (
    frame?.access !== "ok" ||
    !frame.documentId ||
    !frame.snapshotId ||
    frame.generation === undefined
  )
    return undefined
  const source = {
    tabId: observation.tabId,
    frameId,
    documentId: frame.documentId,
    snapshotId: frame.snapshotId,
    generation: frame.generation,
    origin: frame.origin
  }
  const parsed = AgentEvidenceSourceSchema.safeParse(source)
  return parsed.success ? parsed.data : undefined
}

/** Retention is bounded even when a single malformed/restored row is huge. */
export const boundAgentEvidence = (
  records: readonly AgentEvidenceRecord[]
): AgentEvidenceRecord[] => {
  const unique = new Map<string, AgentEvidenceRecord>()
  for (const record of records) {
    const parsed = AgentEvidenceRecordSchema.safeParse(record)
    if (parsed.success) unique.set(record.id, parsed.data)
  }
  const kept = [...unique.values()].slice(-MAX_AGENT_LEDGER_RECORDS)
  // UTF-8 uses at most three bytes per UTF-16 code unit. This conservative
  // bound also covers supplementary characters and JSON escape sequences.
  while (
    kept.length &&
    JSON.stringify(kept).length * 3 > MAX_AGENT_LEDGER_BYTES
  )
    kept.shift()
  return kept
}

const secretShaped = (text: string): boolean =>
  /(?:(?:bearer|basic)\s+\S+|(?:password|secret|token|api[_ -]?key|cookie|authorization|credential|private[_ -]?key)["']?\s*[:=]|\beyJ[\w-]+\.[\w-]+|\b(?:sk|ghp|github_pat)[_-][\w-]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b\d[\d -]{11,}\d\b)/i.test(
    text
  )

const quoteSource = (
  state: AgentRunState,
  observation: AgentObservation,
  claim: AgentSourceQuote,
  needle: string
) => {
  const element = claim.ref
    ? observation.elements.find((item) => item.ref === claim.ref)
    : undefined
  if (claim.ref && (!element || element.sensitive || element.editable))
    return undefined
  if (
    element &&
    claim.frameId !== undefined &&
    element.frameId !== claim.frameId
  )
    return undefined
  const frameId = element?.frameId ?? claim.frameId ?? observation.frameId
  const source = agentEvidenceSource(observation, frameId)
  if (!source || !state.allowedOrigins.includes(source.origin)) return undefined
  const texts = element
    ? [element.name, element.rowContext ?? ""]
    : [
        ...(observation.textPage?.frameId === frameId
          ? [observation.textPage.text]
          : []),
        ...(frameId === observation.frameId &&
        observation.frames.filter((frame) => frame.access === "ok").length === 1
          ? [observation.visibleText, observation.documentText ?? ""]
          : [])
      ]
  if (!texts.some((text) => agentNormalizedClaim(text ?? "").includes(needle)))
    return undefined
  // Sensitive controls do not expose their values in an observation. Their
  // labels must not be captured as a fact either.
  if (
    observation.elements.some(
      (item) =>
        item.sensitive &&
        item.name &&
        needle.includes(agentNormalizedClaim(item.name))
    )
  )
    return undefined
  return source
}

/**
 * Match one contiguous source, never a concatenation of separate controls.
 * Editable values and authored text are not independent source evidence.
 * Composed frame text has no per-span identity: use a ref or extract_text
 * for a child frame instead of guessing which document made the statement.
 */
export const groundAgentQuotes = (
  state: AgentRunState,
  observation: AgentObservation,
  quotes: readonly AgentSourceQuote[],
  authored: readonly string[],
  prefix: string
): AgentEvidenceRecord[] =>
  quotes.flatMap((claim, index) => {
    /**
     * Bound to a planned requirement or limit, or to nothing. A limit is a
     * valid binding because a reviewer may only support one with a
     * quotation the run bound to that exact limit.
     */
    if (
      claim.requirementId &&
      !state.requirements?.some((entry) => entry.id === claim.requirementId) &&
      !state.constraints?.some((entry) => entry.id === claim.requirementId)
    )
      return []
    const needle = agentNormalizedClaim(claim.quote)
    if (!needle || secretShaped(claim.quote)) return []
    if (
      authored.some((text) => {
        const value = agentNormalizedClaim(text)
        return (
          value.length > 0 && (needle.includes(value) || value.includes(needle))
        )
      })
    )
      return []
    if (
      observation.elements.some(
        (item) =>
          item.editable &&
          item.value &&
          (needle.includes(agentNormalizedClaim(item.value)) ||
            agentNormalizedClaim(item.value).includes(needle))
      )
    )
      return []
    const source = quoteSource(state, observation, claim, needle)
    if (!source) return []
    return [
      {
        id: `${prefix}:q${index}`,
        kind: "observed_fact",
        validity: "current",
        source,
        observedAt: observation.capturedAt,
        quote: claim.quote.replaceAll(/\s+/g, " ").trim(),
        ...(claim.requirementId ? { requirementId: claim.requirementId } : {})
      }
    ]
  })

/** Kinds kept as recorded: inputs and claims carry no current-state authority. */
const UNGROUNDED_KINDS = new Set<AgentEvidenceRecord["kind"]>([
  "user_input",
  "agent_input",
  "model_inference",
  "page_tool_claim"
])

/** Kinds that are current only on the very snapshot they were read from. */
const SNAPSHOT_BOUND_KINDS = new Set<AgentEvidenceRecord["kind"]>([
  "observed_fact",
  "visual_observation"
])

/** Latest validity by record id, before retention priority can reorder records. */
export const latestAgentEvidenceRecords = (
  steps: readonly AgentStepReadout[]
): AgentEvidenceRecord[] => {
  const latest = new Map<string, AgentEvidenceRecord>()
  for (const step of [...steps].sort((a, b) => a.sequence - b.sequence))
    for (const record of step.evidenceLedger ?? []) {
      const parsed = AgentEvidenceRecordSchema.safeParse(record)
      latest.delete(record.id)
      if (parsed.success) latest.set(record.id, parsed.data)
    }
  return [...latest.values()]
}

/** Durable quotations survive navigation; current-state authority does not. */
export const buildAgentEvidenceLedger = (
  steps: readonly AgentStepReadout[],
  allowedOrigins: readonly string[],
  observation?: AgentObservation,
  /** Highest priority first; retention still obeys the ledger ceilings. */
  priorityIds: readonly string[] = []
): AgentEvidenceRecord[] =>
  boundAgentEvidence(
    latestAgentEvidenceRecords(steps)
      .flatMap((record) => {
        if (record.source && !allowedOrigins.includes(record.source.origin))
          return []
        if (
          record.validity === "superseded" ||
          record.validity === "incomplete"
        )
          return [record]
        if (record.kind === "verified_effect")
          return [{ ...record, validity: "historical" as const }]
        if (!record.source || UNGROUNDED_KINDS.has(record.kind)) return [record]
        const frame =
          observation?.tabId === record.source.tabId
            ? observation.frames.find(
                (item) => item.frameId === record.source?.frameId
              )
            : undefined
        const sameDocument =
          frame?.access === "ok" &&
          frame.documentId === record.source.documentId
        const sameSnapshot =
          sameDocument &&
          frame.snapshotId === record.source.snapshotId &&
          frame.generation === record.source.generation
        return [
          {
            ...record,
            validity: !observation
              ? ("historical" as const)
              : sameSnapshot && SNAPSHOT_BOUND_KINDS.has(record.kind)
                ? ("current" as const)
                : sameDocument
                  ? ("requires_refresh" as const)
                  : ("historical" as const)
          }
        ]
      })
      .sort((a, b) => {
        const rank = (id: string) => {
          const index = priorityIds.indexOf(id)
          return index < 0 ? 0 : priorityIds.length - index
        }
        return rank(a.id) - rank(b.id)
      })
  )

/** User answers are already durable; retain references, never their contents. */
export const agentUserEvidence = (
  state: AgentRunState
): AgentEvidenceRecord[] =>
  (state.answers ?? []).map((answer) => ({
    id: answer.questionId,
    kind: "user_input",
    validity: "historical",
    observedAt: answer.answeredAt
  }))

const authoredDocument = (
  steps: readonly AgentStepReadout[],
  observation: AgentObservation,
  frameId: number
): boolean => {
  const source = agentEvidenceSource(observation, frameId)
  return steps.some((step) => {
    const command = [...steps]
      .reverse()
      .find(
        (candidate) => candidate.stepId === step.stepId && candidate.command
      )?.command
    const unknownInput =
      !command || JSON.stringify(command).includes("[redacted]")
    return (
      unknownInput &&
      step.evidenceLedger?.some(
        (record) =>
          record.kind === "agent_input" &&
          record.source?.tabId === source?.tabId &&
          record.source?.frameId === frameId &&
          record.source?.documentId === source?.documentId
      )
    )
  })
}

const retainedQuotes = (
  state: AgentRunState,
  observation: AgentObservation,
  quotes: readonly AgentSourceQuote[],
  steps: readonly AgentStepReadout[],
  prefix: string
) =>
  groundAgentQuotes(
    state,
    observation,
    quotes,
    agentAuthoredText({ goal: "", goalAuthor: "model_after_page" }, steps),
    prefix
  ).filter(
    (record) =>
      record.source &&
      !authoredDocument(steps, observation, record.source.frameId)
  )

export const agentCommandEvidence = (
  state: AgentRunState,
  observation: AgentObservation,
  decision: Extract<AgentDecision, { type: "command" }>,
  effect: ResolvedAgentEffect,
  steps: readonly AgentStepReadout[] | undefined,
  prefix: string
): AgentEvidenceRecord[] => {
  const source = agentEvidenceSource(
    observation,
    effect.target.frameId ?? observation.frameId
  )
  const records = steps
    ? retainedQuotes(
        state,
        observation,
        decision.sourceQuotes ?? [],
        steps,
        prefix
      )
    : []
  if (!source) return records
  if (decision.finding)
    records.push({
      id: `${prefix}:inference`,
      kind: "model_inference",
      validity: "incomplete",
      source,
      observedAt: observation.capturedAt
    })
  if (decision.command.type === "call_page_tool")
    records.push({
      id: `${prefix}:tool`,
      kind: "page_tool_claim",
      validity: "incomplete",
      source,
      observedAt: observation.capturedAt
    })
  const refs =
    decision.command.type === "fill_form"
      ? decision.command.fields.map((field) => field.ref)
      : []
  const frames = refs.length
    ? [
        ...new Set(
          refs.map(
            (ref) =>
              observation.elements.find((item) => item.ref === ref)?.frameId
          )
        )
      ]
    : [source.frameId]
  if (
    ["type", "clear_and_type", "replace_text", "select", "fill_form"].includes(
      decision.command.type
    )
  ) {
    for (const frameId of frames) {
      const inputSource =
        frameId === undefined
          ? undefined
          : agentEvidenceSource(observation, frameId)
      if (inputSource)
        records.push({
          id: `${prefix}:input:${frameId}`,
          kind: "agent_input",
          validity: "historical",
          source: inputSource,
          observedAt: observation.capturedAt
        })
    }
  }
  return boundAgentEvidence(records)
}

export const agentVerificationEvidence = (
  observation: AgentObservation,
  effect: ResolvedAgentEffect,
  verification: AgentVerificationResult,
  requirementId: string | undefined,
  prefix: string
): AgentEvidenceRecord[] => {
  const source = agentEvidenceSource(
    observation,
    effect.target.frameId ?? observation.frameId
  )
  if (!source) return []
  return boundAgentEvidence([
    {
      id: `${prefix}:effect`,
      kind: "verified_effect",
      source,
      validity:
        verification.outcome === "confirmed" ? "historical" : "incomplete",
      observedAt: verification.evidence.observedAt,
      verificationKind: verification.evidence.kind,
      ...(requirementId ? { requirementId } : {})
    }
  ])
}

/**
 * The picture a decision was shown, if it belongs to the observation the
 * decision was made on. A picture of another snapshot says nothing about the
 * page being judged.
 */
const boundScreenshot = (
  observation: AgentObservation,
  screenshot: AgentScreenshot | undefined
): AgentScreenshot | undefined =>
  screenshot &&
  screenshot.snapshotId === observation.snapshotId &&
  screenshot.generation === observation.generation &&
  screenshot.documentId === observation.documentId &&
  screenshot.tabId === observation.tabId
    ? screenshot
    : undefined

/**
 * Read answers the model took off the screenshot it completed on, where no
 * page text grounds them. Content-free beyond the model's own reading: the
 * source is the picture's snapshot identity and origin, never the image, and
 * only a planned read can be bound — a picture never proves a change.
 */
const visualCompletionEvidence = (
  state: AgentRunState,
  observation: AgentObservation,
  decision: Extract<AgentDecision, { type: "complete" }>,
  screenshot: AgentScreenshot | undefined,
  grounded: readonly AgentEvidenceRecord[],
  prefix: string
): AgentEvidenceRecord[] => {
  const picture = boundScreenshot(observation, screenshot)
  if (!picture) return []
  const source = agentEvidenceSource(observation, picture.frameId)
  if (!source || !state.allowedOrigins.includes(source.origin)) return []
  return (decision.outcomes ?? []).flatMap((outcome) => {
    const requirement = state.requirements?.find(
      (entry) => entry.id === outcome.id && entry.kind === "read"
    )
    if (!outcome.met || !requirement) return []
    /** Itemized reads are judged by their items, never the parent evidence. */
    const claims = requirement.items?.length
      ? (outcome.items ?? [])
          .filter((item) => item.met)
          .map((item) => ({
            evidence: item.evidence,
            suffix: `:item:${item.index}`
          }))
      : [{ evidence: outcome.evidence, suffix: "" }]
    return claims.flatMap((claim) => {
      const quote = claim.evidence?.replaceAll(/\s+/g, " ").trim()
      if (
        !quote ||
        quote.length > MAX_AGENT_SOURCE_QUOTE_CHARS ||
        secretShaped(quote) ||
        groundedCompletionQuote(quote, outcome.id, grounded)
      )
        return []
      return [
        {
          id: `${prefix}:visual:${outcome.id}${claim.suffix}`,
          kind: "visual_observation" as const,
          validity: "current" as const,
          source,
          observedAt: picture.capturedAt,
          requirementId: outcome.id,
          quote
        }
      ]
    })
  })
}

export const agentCompletionEvidence = (
  state: AgentRunState,
  observation: AgentObservation,
  decision: Extract<AgentDecision, { type: "complete" }>,
  steps: readonly AgentStepReadout[] | undefined,
  prefix: string,
  /** The picture the completing decision was shown, if it was shown one. */
  screenshot?: AgentScreenshot
): AgentEvidenceRecord[] => {
  if (!steps) return []
  const quotes: AgentSourceQuote[] = [
    ...(decision.sourceQuotes ?? []),
    ...(decision.outcomes ?? []).flatMap((outcome) => [
      ...(outcome.evidence
        ? [{ quote: outcome.evidence, requirementId: outcome.id }]
        : []),
      ...(outcome.items ?? []).flatMap((item) =>
        item.evidence
          ? [{ quote: item.evidence, requirementId: outcome.id }]
          : []
      )
    ])
  ]
  // Grounding establishes provenance only; the judge checks satisfaction.
  const grounded = retainedQuotes(state, observation, quotes, steps, prefix)
  return boundAgentEvidence([
    ...grounded,
    ...visualCompletionEvidence(
      state,
      observation,
      decision,
      screenshot,
      grounded,
      prefix
    )
  ])
}
