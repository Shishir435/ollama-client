import {
  type AgentCommand,
  type AgentDecision,
  type AgentEvidenceRecord,
  AgentEvidenceRecordSchema,
  AgentEvidenceSourceSchema,
  type AgentObservation,
  type AgentRunState,
  type AgentScreenshot,
  type AgentSourceQuote,
  MAX_AGENT_LEDGER_BYTES,
  MAX_AGENT_EVIDENCE_LEAD_CHARS,
  MAX_AGENT_EVIDENCE_PAGE_ITEMS,
  MAX_AGENT_LEDGER_RECORDS,
  MAX_AGENT_REQUIREMENT_ITEM_LINK_CHARS,
  MAX_AGENT_SOURCE_QUOTE_CHARS
} from "@ollama-client/contracts"
import {
  agentFollowedLink,
  groundedCompletionQuote
} from "./completion-support"
import { agentStepSourceUrl, latestAgentSteps } from "./history"
import { agentNormalizedClaim } from "./observed-text"
import type {
  AgentStepReadout,
  AgentVerificationResult,
  ResolvedAgentEffect
} from "./ports"
import { agentAuthoredText, agentCommandAuthoredText } from "./provenance"
import { agentTextNamesRecord } from "./row-context"

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

/**
 * Receipts that show what a change left on the page — a field's value, a
 * box's state — rather than only that a press landed. A change requirement
 * can cite nothing else, so they are kept like facts.
 */
const RESULT_EFFECT_KINDS = new Set([
  "field",
  "fields",
  "checked",
  "arrangement",
  "condition"
])

/**
 * Retention is bounded even when a single malformed/restored row is huge.
 *
 * What goes first when the ledger is full: a receipt that only says a
 * navigation or an activation landed, then any other record, including a
 * receipt showing a change's result, then the ones the caller protects —
 * oldest first within each. Every step adds a receipt and few add
 * a fact, so dropping by age alone left a forty-step comparison holding
 * forty "navigation committed" receipts and none of the five prices it had
 * read; the model then reported them all missing. The receipts stay
 * durable in the step rows either way.
 */
export const boundAgentEvidence = (
  records: readonly AgentEvidenceRecord[],
  protectedIds: readonly string[] = []
): AgentEvidenceRecord[] => {
  const unique = new Map<string, AgentEvidenceRecord>()
  for (const record of records) {
    const parsed = AgentEvidenceRecordSchema.safeParse(record)
    if (parsed.success) unique.set(record.id, parsed.data)
  }
  const kept = [...unique.values()]
  const protectedSet = new Set(protectedIds)
  /**
   * Among those landing receipts, one bound to an outcome outlives one bound
   * to none. Measured live: a run that opened two source tabs and then
   * switched between them four times evicted the first open — the only
   * receipt for half its outcome — and kept every unbound switch.
   */
  const evictionRank = (record: AgentEvidenceRecord): number =>
    protectedSet.has(record.id)
      ? 3
      : record.kind === "verified_effect" &&
          !RESULT_EFFECT_KINDS.has(record.verificationKind ?? "")
        ? record.requirementId === undefined
          ? 0
          : 1
        : 2
  const evict = () => {
    let victim = 0
    for (let index = 1; index < kept.length; index += 1)
      if (evictionRank(kept[index]) < evictionRank(kept[victim])) victim = index
    kept.splice(victim, 1)
  }
  while (kept.length > MAX_AGENT_LEDGER_RECORDS) evict()
  // UTF-8 uses at most three bytes per UTF-16 code unit. This conservative
  // bound also covers supplementary characters and JSON escape sequences.
  while (
    kept.length &&
    JSON.stringify(kept).length * 3 > MAX_AGENT_LEDGER_BYTES
  )
    evict()
  return kept
}

const secretShaped = (text: string): boolean =>
  /(?:(?:bearer|basic)\s+\S+|(?:password|secret|token|api[_ -]?key|cookie|authorization|credential|private[_ -]?key)["']?\s*[:=]|\beyJ[\w-]+\.[\w-]+|\b(?:sk|ghp|github_pat)[_-][\w-]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b\d[\d -]{11,}\d\b)/i.test(
    text
  )

/**
 * The plan's read items the frame's page names in its opening text — the
 * heading a line of prices sits under. Only the plan's own words are kept.
 */
const itemsLeading = (
  state: Pick<AgentRunState, "requirements">,
  observation: AgentObservation,
  frameId: number
): string[] => {
  const lead = pageLead(observation, frameId)
  if (!lead) return []
  const items = (state.requirements ?? []).flatMap((requirement) =>
    requirement.kind === "read" ? (requirement.items ?? []) : []
  )
  return [...new Set(items)]
    .filter((item) => agentTextNamesRecord(lead, item))
    .slice(0, MAX_AGENT_EVIDENCE_PAGE_ITEMS)
}

/**
 * How the frame's page begins: its document text from the top when that is
 * the one frame read, its own part of the joined text otherwise.
 */
const pageLead = (
  observation: AgentObservation,
  frameId: number
): string | undefined => {
  const single =
    observation.frames.filter((frame) => frame.access === "ok").length === 1
  const text =
    single && frameId === observation.frameId
      ? (observation.documentText ?? observation.visibleText)
      : frameText(observation, frameId)
  return (
    text
      .replaceAll(/\s+/g, " ")
      .trim()
      .slice(0, MAX_AGENT_EVIDENCE_LEAD_CHARS)
      .trim() || undefined
  )
}

/** A read frame's own part of the joined visible text, when it is known. */
const frameText = (observation: AgentObservation, frameId: number): string => {
  const frame = observation.frames.find(
    (entry) => entry.frameId === frameId && entry.access === "ok"
  )
  return frame?.textSpan
    ? observation.visibleText.slice(frame.textSpan.start, frame.textSpan.end)
    : ""
}

/**
 * The one read frame whose own text holds a quote the model gave no frame
 * for. None when it is in no frame's text, or in more than one: a phrase two
 * frames share says nothing about which of them the model read it in.
 */
const frameQuoting = (
  observation: AgentObservation,
  needle: string
): number | undefined => {
  const holding = observation.frames.filter(
    (frame) =>
      frame.access === "ok" &&
      frame.textSpan !== undefined &&
      agentNormalizedClaim(frameText(observation, frame.frameId)).includes(
        needle
      )
  )
  return holding.length === 1 ? holding[0].frameId : undefined
}

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
  const frameId =
    element?.frameId ??
    claim.frameId ??
    frameQuoting(observation, needle) ??
    observation.frameId
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
          : [frameText(observation, frameId)])
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

interface CompactClaim {
  text: string
  /** Offsets in `text` where a word starts or ends. */
  edges: ReadonlySet<number>
}

/**
 * The words of a claim, lowercased and joined with nothing between them. A
 * word is a run of letters and digits, and a point or comma with a digit on
 * both sides stays inside it — after a letter it is punctuation, so "AB.12"
 * is the words "ab" and "12": "1.2" read off a chart is not the "12" a field
 * holds. Spacing, case and other punctuation are dropped, so "KV-305"
 * reported as "KV 305" is the same text.
 */
const compactClaim = (text: string): CompactClaim => {
  const words =
    text
      .toLocaleLowerCase()
      .match(/(?:[\p{L}\p{N}]|(?<=\p{N})[.,](?=\p{N}))+/gu) ?? []
  const edges = new Set<number>([0])
  let length = 0
  for (const word of words) {
    length += word.length
    edges.add(length)
  }
  return { text: words.join(""), edges }
}

/**
 * Whether `part` occurs in `whole` starting and ending on word edges. Joined
 * text alone would find "ab12" inside "Lab 12 is open"; edges keep a supplied
 * value from matching inside an unrelated word while "kv305" still matches
 * the words "KV 305".
 */
const occursAtEdges = (whole: CompactClaim, part: string): boolean => {
  for (
    let at = whole.text.indexOf(part);
    at >= 0;
    at = whole.text.indexOf(part, at + 1)
  )
    if (whole.edges.has(at) && whole.edges.has(at + part.length)) return true
  return false
}

/**
 * Whether every word a write is about to put on the page is already there,
 * in the page's own text rather than a field's value. Read off the
 * observation the write was chosen on, so nothing the write did can count;
 * a value with no words is nobody's and settles nothing.
 */
const MIN_SHOWN_WRITE_CHARS = 8

export const agentWriteShownBefore = (
  command: AgentCommand,
  observation: AgentObservation
): boolean => {
  const value = compactClaim(agentCommandAuthoredText(command) ?? "")
  /**
   * A short value — "5", "Yes", "Blue" — is somewhere on almost every page,
   * a count or a menu entry, so finding it proves nothing: two words or a
   * long one, or the run's own value stays its own.
   */
  if (value.edges.size < 3 && value.text.length < MIN_SHOWN_WRITE_CHARS)
    return false
  const page = compactClaim(observation.visibleText)
  return (
    occursAtEdges(page, value.text) &&
    !observation.elements.some(
      (element) =>
        element.editable === true &&
        !!element.value &&
        occursAtEdges(compactClaim(element.value), value.text)
    )
  )
}

/**
 * Whether a claim is text the run supplied rather than read: words it was
 * given or typed, or what an editable field now holds. Either way the page is
 * only repeating the run, so it can prove no read — whether the claim arrives
 * as a quotation or as something read off a screenshot. A value with no words,
 * such as a field holding only spaces, supplies nothing and excludes nothing.
 */
const runSupplied = (
  claim: string,
  authored: readonly string[],
  observation: AgentObservation
): boolean => {
  const needle = compactClaim(claim)
  if (!needle.text) return false
  const supplies = (text: string) => {
    const value = compactClaim(text)
    return (
      value.text.length > 0 &&
      (occursAtEdges(needle, value.text) || occursAtEdges(value, needle.text))
    )
  }
  return (
    authored.some(supplies) ||
    observation.elements.some(
      (item) => item.editable === true && !!item.value && supplies(item.value)
    )
  )
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
    if (runSupplied(claim.quote, authored, observation)) return []
    const source = quoteSource(state, observation, claim, needle)
    if (!source) return []
    const pageItems = itemsLeading(state, observation, source.frameId)
    return [
      {
        id: `${prefix}:q${index}`,
        kind: "observed_fact",
        validity: "current",
        source,
        observedAt: observation.capturedAt,
        quote: claim.quote.replaceAll(/\s+/g, " ").trim(),
        ...(pageItems.length ? { pageItems } : {}),
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
  priorityIds: readonly string[] = [],
  /** Durable-state references compete in the same retention pass as receipts. */
  additionalRecords: readonly AgentEvidenceRecord[] = []
): AgentEvidenceRecord[] =>
  boundAgentEvidence(
    [...latestAgentEvidenceRecords(steps), ...additionalRecords]
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
      }),
    priorityIds
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
      ...(requirementId ? { requirementId } : {}),
      ...openedDestination(effect, verification)
    }
  ])
}

/**
 * Where a confirmed `open_tab` went, as its step receipt keeps it: origin and
 * path. Only for a tab the verifier saw commit, so the receipt can say which
 * page an "open every link" item was opened at.
 */
const openedDestination = (
  effect: ResolvedAgentEffect,
  verification: AgentVerificationResult
): { destination?: string } => {
  if (
    effect.command.type !== "open_tab" ||
    verification.outcome !== "confirmed" ||
    verification.evidence.kind !== "tab"
  )
    return {}
  const destination = agentStepSourceUrl(effect.command.url)?.slice(
    0,
    MAX_AGENT_REQUIREMENT_ITEM_LINK_CHARS
  )
  return destination ? { destination } : {}
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
  steps: readonly AgentStepReadout[],
  prefix: string
): AgentEvidenceRecord[] => {
  const picture = boundScreenshot(observation, screenshot)
  if (!picture) return []
  const source = agentEvidenceSource(observation, picture.frameId)
  if (!source || !state.allowedOrigins.includes(source.origin)) return []
  /** A document the run wrote into unrecorded text cannot show what it read. */
  if (authoredDocument(steps, observation, source.frameId)) return []
  const authored = agentAuthoredText(
    { goal: "", goalAuthor: "model_after_page" },
    steps
  )
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
        runSupplied(quote, authored, observation) ||
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
      steps,
      prefix
    )
  ])
}

/**
 * The first open read item this page names that nothing from this page has
 * been retained for, when the step is about to leave it.
 *
 * Measured live: told to find every order Ada Lovelace placed across five
 * pages, a run clicked Next four times past "ORD-1042 Ada Lovelace" on page
 * one and reported only the order on the last page. Nothing it was shown
 * was missing; it was simply never kept, and once the page was gone no
 * check could tell the answer was short. Leaving is the last moment the
 * runtime can still see what the page said, so the step is refused until
 * the page's facts ride on it as `sourceQuotes` — or were already retained
 * from this same document.
 */
export const agentUnretainedSighting = (
  state: Pick<AgentRunState, "requirements" | "evidenceLedger">,
  observation: AgentObservation,
  decision: Extract<AgentDecision, { type: "command" }>
): { requirementId: string; item: string } | undefined => {
  const documentId = agentEvidenceSource(
    observation,
    observation.frameId
  )?.documentId
  if (!documentId) return undefined
  const text = observation.documentText ?? observation.visibleText
  for (const requirement of state.requirements ?? []) {
    if (requirement.kind !== "read" || !requirement.items?.length) continue
    const kept =
      (decision.sourceQuotes ?? []).some(
        (quote) => quote.requirementId === requirement.id
      ) ||
      (state.evidenceLedger ?? []).some(
        (record) =>
          record.kind === "observed_fact" &&
          record.requirementId === requirement.id &&
          record.source?.documentId === documentId
      )
    if (kept) continue
    const item = requirement.items.find((entry) =>
      agentTextNamesRecord(text, entry)
    )
    if (item !== undefined) return { requirementId: requirement.id, item }
  }
  return undefined
}

/**
 * A source the run opened for a read and is about to leave with nothing
 * kept from it: the last move was a link it followed for a read requirement,
 * and no fact from this document is retained or riding on the step. Measured
 * live: a research run clicked into each source and back again a dozen
 * times without one quote, then reported every read unmet. Reads with items
 * are caught by the items the page names; this is the rest.
 */
export const agentUnretainedSource = (
  state: Pick<AgentRunState, "requirements" | "evidenceLedger">,
  observation: AgentObservation,
  decision: Extract<AgentDecision, { type: "command" }>,
  steps: readonly AgentStepReadout[]
): { requirementId: string; link: string } | undefined => {
  if (decision.sourceQuotes?.length) return undefined
  const documentId = agentEvidenceSource(
    observation,
    observation.frameId
  )?.documentId
  if (!documentId) return undefined
  /** One row per step: only the first of a step's rows names its requirement. */
  const move = latestAgentSteps(steps)
    .filter(
      (step) =>
        step.verification?.outcome === "confirmed" &&
        (agentFollowedLink(step) ||
          ["navigate", "back", "open_tab", "switch_tab"].includes(
            step.command?.type ?? ""
          ))
    )
    .sort((first, second) => second.sequence - first.sequence)[0]
  if (!move || !agentFollowedLink(move) || !move.target?.name) return undefined
  const read = state.requirements?.find(
    (requirement) =>
      requirement.id === move.requirementId && requirement.kind === "read"
  )
  if (!read) return undefined
  const kept = (state.evidenceLedger ?? []).some(
    (record) =>
      record.kind === "observed_fact" &&
      record.source?.documentId === documentId
  )
  return kept ? undefined : { requirementId: read.id, link: move.target.name }
}
