import {
  type AgentEvidenceRecord,
  type AgentObservation,
  type AgentRunState,
  type AgentTaskRequirement,
  type AgentWorkflow,
  type AgentWorkflowEntry,
  AgentWorkflowSchema,
  MAX_AGENT_WORKFLOW_BYTES,
  MAX_AGENT_WORKFLOW_EVIDENCE
} from "@ollama-client/contracts"
import {
  agentReceiptNamesItem,
  agentWorkflowReceiptSupport,
  isAgentChangeReceipt
} from "./completion"
import {
  agentUserEvidence,
  boundAgentEvidence,
  buildAgentEvidenceLedger,
  latestAgentEvidenceRecords
} from "./evidence-ledger"
import { latestAgentSteps } from "./history"
import { agentNormalizedClaim } from "./observed-text"
import type { AgentStepReadout } from "./ports"
import { agentEffectSettlement } from "./prior-effects"

/** A complete item identity, never a prefix such as Invoice 1 in Invoice 10. */
const namesItem = (text: string, item: string): boolean => {
  const escaped = agentNormalizedClaim(item).replaceAll(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  )
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`,
    "u"
  ).test(agentNormalizedClaim(text))
}

interface WorkflowUnit {
  requirement: AgentTaskRequirement
  item: string | undefined
  itemIndex: number | undefined
}

const units = (state: AgentRunState): WorkflowUnit[] =>
  (state.requirements ?? []).flatMap<WorkflowUnit>((requirement) =>
    requirement.items?.length
      ? requirement.items.map((item, itemIndex) => ({
          requirement,
          item,
          itemIndex
        }))
      : [{ requirement, item: undefined, itemIndex: undefined }]
  )

const supportsUnit = (
  record: AgentEvidenceRecord,
  unit: WorkflowUnit
): boolean =>
  record.kind === "observed_fact" &&
  record.requirementId === unit.requirement.id &&
  (!unit.item || (!!record.quote && namesItem(record.quote, unit.item)))

const workflowReceiptSettlement = (step: AgentStepReadout) =>
  step.status === "verified" && step.verification?.outcome !== "confirmed"
    ? "unknown"
    : agentEffectSettlement(step.status)

const workflowEffect = (
  related: readonly AgentStepReadout[]
): AgentWorkflowEntry["effect"] => {
  const applied = related.filter(
    (step) =>
      isAgentChangeReceipt(step) ||
      (step.status === "approved" && step.mutating === true)
  )
  const step =
    [...applied]
      .reverse()
      .find((step) => workflowReceiptSettlement(step) === "unknown") ??
    applied.at(-1)
  if (!step) return undefined
  return {
    sequence: step.sequence,
    settlement:
      workflowReceiptSettlement(step) === "confirmed" ? "confirmed" : "unknown"
  }
}

const workflowBlocker = (
  available: boolean,
  effect: AgentWorkflowEntry["effect"],
  last: AgentStepReadout | undefined,
  missingEvidence: boolean
): AgentWorkflowEntry["blocker"] => {
  if (!available) return "history_unavailable"
  if (effect?.settlement === "unknown") return "effect_unresolved"
  if (last?.status === "rejected") return "step_refused"
  if (last?.status === "failed") return "step_failed"
  return missingEvidence ? "evidence_unavailable" : undefined
}

const workflowStatus = (
  kind: AgentTaskRequirement["kind"],
  available: boolean,
  effect: AgentWorkflowEntry["effect"],
  proven: boolean,
  evidenceIds: readonly string[],
  blocker: AgentWorkflowEntry["blocker"]
): AgentWorkflowEntry["status"] => {
  if (!available) return "needs_refresh"
  if (effect?.settlement === "unknown") return "effect_uncertain"
  if (proven) return "verified"
  if (kind === "read" && evidenceIds.length) return "supported"
  if (effect) return "effect_confirmed"
  if (evidenceIds.length) return "supported"
  if (blocker === "evidence_unavailable") return "needs_refresh"
  return blocker ? "blocked" : "pending"
}

const workflowEntry = (
  unit: WorkflowUnit,
  steps: readonly AgentStepReadout[],
  latest: readonly AgentStepReadout[],
  ledger: readonly AgentEvidenceRecord[],
  observation: AgentObservation,
  available: boolean,
  consumed: Set<string>
): AgentWorkflowEntry => {
  const { requirement, item, itemIndex } = unit
  const related = latest.filter(
    (step) =>
      step.requirementId === requirement.id &&
      (!item ||
        agentReceiptNamesItem(step, item, requirement.items ?? [], observation))
  )
  const effect = workflowEffect(related)
  const proven = agentWorkflowReceiptSupport(
    requirement,
    item,
    steps,
    observation,
    consumed
  )
  const evidenceIds = ledger
    .filter(
      (record) =>
        supportsUnit(record, unit) &&
        ["current", "historical"].includes(record.validity)
    )
    .slice(-MAX_AGENT_WORKFLOW_EVIDENCE)
    .map((record) => record.id)
  const hadSupport = steps.some((step) =>
    step.evidenceLedger?.some((record) => supportsUnit(record, unit))
  )
  const blocker = workflowBlocker(
    available,
    effect,
    related.at(-1),
    hadSupport && evidenceIds.length === 0
  )
  return {
    requirementId: requirement.id,
    ...(itemIndex !== undefined ? { itemIndex } : {}),
    status: workflowStatus(
      requirement.kind,
      available,
      effect,
      !!proven,
      evidenceIds,
      blocker
    ),
    evidenceIds,
    ...(effect ? { effect } : {}),
    ...(blocker ? { blocker } : {})
  }
}

/** Preserve one fact from each document before more detail from the same source. */
const balancedWorkflowSources = (
  records: readonly AgentEvidenceRecord[]
): AgentEvidenceRecord[] => {
  const sources = new Map<string, AgentEvidenceRecord[]>()
  for (const record of records) {
    if (!record.source) continue
    const key = `${record.source.tabId}:${record.source.frameId}:${record.source.documentId}`
    const group = sources.get(key) ?? []
    group.unshift(record)
    sources.set(key, group)
  }
  const selected: AgentEvidenceRecord[] = []
  for (
    let rank = 0;
    rank < records.length && selected.length < MAX_AGENT_WORKFLOW_EVIDENCE;
    rank += 1
  ) {
    for (const group of sources.values()) {
      if (selected.length === MAX_AGENT_WORKFLOW_EVIDENCE) break
      if (group[rank]) selected.push(group[rank])
    }
  }
  return selected
}

/**
 * Facts linked to the plan get retention priority over interaction detail.
 * One support per unit is preferred before additional sources for that unit.
 * The ledger's existing count/byte ceilings still decide what fits.
 */
const retainedWorkflowLedger = (
  state: AgentRunState,
  steps: readonly AgentStepReadout[],
  observation: AgentObservation
): AgentEvidenceRecord[] => {
  const candidates = latestAgentEvidenceRecords(steps)
  const perUnit = units(state).map(({ requirement, item }) => {
    const unique = new Map<string, AgentEvidenceRecord>()
    for (const record of candidates) {
      if (
        record.kind !== "observed_fact" ||
        !record.source ||
        !record.quote ||
        record.requirementId !== requirement.id ||
        !state.allowedOrigins.includes(record.source.origin) ||
        record.validity === "superseded" ||
        record.validity === "incomplete" ||
        (item && !namesItem(record.quote, item))
      )
        continue
      unique.set(
        `${record.source.tabId}:${record.source.frameId}:${record.source.documentId}:${agentNormalizedClaim(record.quote)}`,
        record
      )
    }
    return balancedWorkflowSources([...unique.values()])
  })
  const priority: string[] = []
  for (let rank = 0; rank < MAX_AGENT_WORKFLOW_EVIDENCE; rank += 1)
    for (const records of perUnit)
      if (records[rank]) priority.push(records[rank].id)
  return buildAgentEvidenceLedger(
    steps,
    state.allowedOrigins,
    observation,
    priority
  )
}

/** Omission is unknown, even when a durable checkpoint once referenced the fact. */
export const projectAgentWorkflow = (
  workflow: AgentWorkflow,
  ledger: readonly AgentEvidenceRecord[],
  historyAvailable = true
): AgentWorkflow => {
  const entries = workflow.entries.map((entry): AgentWorkflowEntry => {
    const evidenceIds = entry.evidenceIds.filter((id) =>
      ledger.some(
        (record) =>
          record.id === id &&
          record.kind === "observed_fact" &&
          (record.validity === "current" || record.validity === "historical")
      )
    )
    if (!historyAvailable)
      return {
        ...entry,
        evidenceIds: [],
        status: entry.effect ? "effect_uncertain" : "needs_refresh",
        ...(entry.effect
          ? { effect: { ...entry.effect, settlement: "unknown" } }
          : {}),
        blocker: "history_unavailable"
      }
    if (
      entry.status === "supported" &&
      evidenceIds.length < entry.evidenceIds.length
    )
      return {
        ...entry,
        evidenceIds,
        status: "needs_refresh",
        blocker: "evidence_unavailable"
      }
    return { ...entry, evidenceIds }
  })
  return { ...workflow, entries, phase: workflowPhase(entries, workflow.phase) }
}

/** A phase is a cursor over the existing plan, with one final review phase. */
const workflowPhase = (
  entries: readonly AgentWorkflowEntry[],
  prior?: AgentWorkflow["phase"]
): AgentWorkflow["phase"] => {
  const unresolved = entries.findIndex(
    (entry) => entry.status === "effect_uncertain"
  )
  if (unresolved >= 0)
    return { index: unresolved, total: entries.length, kind: "reconcile" }
  const pending = entries.findIndex(
    (entry) => !["supported", "verified"].includes(entry.status)
  )
  return pending < 0
    ? { index: entries.length, total: entries.length, kind: "review" }
    : {
        index: pending,
        total: entries.length,
        kind:
          entries[pending].status === "effect_confirmed"
            ? "verify"
            : entries[pending].status === "needs_refresh" ||
                (prior?.index === pending && prior.kind === "read")
              ? "read"
              : "act"
      }
}

/**
 * Deterministic compaction of the full receipt record. No model summary can
 * add a fact, erase a limit, settle an uncertain effect or complete a goal.
 * Rebuilt after an amendment so item positions always refer to the current plan.
 */
export const buildAgentWorkflow = (
  state: AgentRunState,
  steps: readonly AgentStepReadout[] | undefined,
  observation: AgentObservation
):
  | { workflow: AgentWorkflow; evidenceLedger: AgentEvidenceRecord[] }
  | undefined => {
  if (!state.requirements?.length) return undefined
  const historyAvailable = steps !== undefined
  if (!steps) {
    if (
      state.workflow &&
      state.workflow.planVersion === (state.plan?.version ?? 1)
    ) {
      const cached = AgentWorkflowSchema.safeParse(
        projectAgentWorkflow(state.workflow, [], false)
      )
      return cached.success
        ? {
            workflow: cached.data,
            evidenceLedger: boundAgentEvidence(agentUserEvidence(state))
          }
        : undefined
    }
    steps = []
  }
  const latest = latestAgentSteps(steps)
  /** Keep answer provenance within the same bounds, before deriving support. */
  const evidenceLedger = boundAgentEvidence([
    ...retainedWorkflowLedger(state, steps, observation),
    ...agentUserEvidence(state)
  ])
  const consumed = new Set<string>()
  const entries = units(state).map((unit) =>
    workflowEntry(
      unit,
      steps,
      latest,
      evidenceLedger,
      observation,
      historyAvailable,
      consumed
    )
  )
  const phase = workflowPhase(entries)
  if (
    phase.kind === "act" &&
    state.requirements.find(
      (requirement) => requirement.id === entries[phase.index]?.requirementId
    )?.kind === "read"
  )
    phase.kind = "read"
  const checkpoint = {
    version: 1 as const,
    planVersion: state.plan?.version ?? 1,
    throughSequence: latest.at(-1)?.sequence ?? 0,
    entries,
    phase
  }
  while (JSON.stringify(checkpoint).length * 3 > MAX_AGENT_WORKFLOW_BYTES) {
    const entry = [...entries].sort(
      (a, b) => b.evidenceIds.length - a.evidenceIds.length
    )[0]
    if (!entry?.evidenceIds.length) break
    entry.evidenceIds.pop()
    if (entry.status === "supported") {
      entry.status = "needs_refresh"
      entry.blocker = "evidence_unavailable"
    }
  }
  if (JSON.stringify(checkpoint).length * 3 > MAX_AGENT_WORKFLOW_BYTES)
    return undefined
  const workflow = AgentWorkflowSchema.safeParse(
    projectAgentWorkflow(checkpoint, evidenceLedger)
  )
  return workflow.success
    ? { workflow: workflow.data, evidenceLedger }
    : undefined
}
