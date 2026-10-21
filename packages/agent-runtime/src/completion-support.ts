import type {
  AgentEvidenceRecord,
  AgentObservation,
  AgentTaskRequirement
} from "@ollama-client/contracts"
import { latestAgentSteps } from "./history"
import { agentNormalizedClaim } from "./observed-text"
import type { AgentStepReadout } from "./ports"
import { agentRowContextBeyond, agentTextNamesRecord } from "./row-context"

const same = (a: string, b: string) =>
  agentNormalizedClaim(a) === agentNormalizedClaim(b)
/**
 * The controls a check names: those whose label is the name exactly, or,
 * when none is, those whose label holds the name as a whole phrase. A
 * planner shortens labels — the check said "terms" for a box labelled "I
 * accept the terms", and was never met on any page. Several phrase matches
 * stay several, so an ambiguous name is still no answer.
 */
const namedBy = <T>(
  items: readonly T[],
  label: (item: T) => string | undefined,
  name: string
): T[] => {
  const exact = items.filter((item) => {
    const text = label(item)
    return text !== undefined && same(text, name)
  })
  if (exact.length) return exact
  return items.filter((item) => {
    const text = label(item)
    return text !== undefined && agentTextNamesRecord(text, name)
  })
}

const escapePattern = (text: string) =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * Every retained fact a quote stands on. Two shops can show the same line,
 * and only the page each was read on tells them apart.
 */
export const groundedCompletionQuotes = (
  quote: string | undefined,
  requirementId: string,
  ledger: readonly AgentEvidenceRecord[] | undefined,
  current = false
): AgentEvidenceRecord[] =>
  (ledger ?? []).filter(
    (record) =>
      record.kind === "observed_fact" &&
      record.source &&
      record.quote &&
      quote &&
      (record.requirementId === undefined ||
        record.requirementId === requirementId) &&
      (record.validity === "current" ||
        (!current && record.validity === "historical")) &&
      same(record.quote, quote)
  )

/** Only independently observed facts, never inputs or model/tool claims. */
export const groundedCompletionQuote = (
  quote: string | undefined,
  requirementId: string,
  ledger: readonly AgentEvidenceRecord[] | undefined,
  current = false
): AgentEvidenceRecord | undefined =>
  groundedCompletionQuotes(quote, requirementId, ledger, current)[0]

/**
 * A read the model took off the screenshot it completed on, answered exactly
 * as it read it. Current only: a reading of an earlier picture describes a
 * page that may have moved since. Never independent support — the picture's
 * own words are the model's — so it settles a read as seen, not verified.
 */
export const visualCompletionRead = (
  quote: string | undefined,
  requirementId: string,
  ledger: readonly AgentEvidenceRecord[] | undefined
) =>
  ledger?.find(
    (record) =>
      record.kind === "visual_observation" &&
      record.validity === "current" &&
      record.source &&
      record.quote &&
      quote &&
      record.requirementId === requirementId &&
      same(record.quote, quote)
  )

/** A control write the verifier confirmed by the value it left behind. */
const FIELD_WRITE_KINDS = new Set(["field", "fields"])
/** The same for a box or switch, confirmed by the state it left behind. */
const CHECKED_WRITE_KINDS = new Set(["checked", "fields"])

/**
 * Whether a confirmed write left its control holding exactly the value the
 * requirement it advanced names. Decided when the step is verified, the one
 * moment both are known: a receipt redacts what was typed, and the control
 * may be gone from the page a later submission opened. A plain `type`
 * appends, so it holds the planned value only when its resolved result is
 * that value, which is what `expectedValue` already says. A batch holds it
 * only through the one field of that name it set; two of the same name are
 * no answer.
 */
export const agentWriteHeldPlannedValue = (
  requirement: AgentTaskRequirement | undefined,
  targets: readonly {
    accessibleName?: string
    tag?: string
    expectedValue?: string
    expectedChecked?: boolean
    sensitive?: boolean
    frameId?: number
  }[],
  verification: { outcome: string; evidence: { kind: string } }
): boolean => {
  const check = requirement?.check
  if (!check && requirement?.kind === "change")
    return heldQuotedLiteral(requirement, targets, verification)
  if (
    !check ||
    (check.type !== "field" &&
      check.type !== "selected" &&
      check.type !== "checked") ||
    check.record ||
    verification.outcome !== "confirmed" ||
    !(check.type === "checked" ? CHECKED_WRITE_KINDS : FIELD_WRITE_KINDS).has(
      verification.evidence.kind
    )
  )
    return false
  /**
   * The check's frame, when it names one: a Name field written in the page
   * is not the Name field the requirement named inside a frame, and the
   * receipt that later stands for it keeps no frame to tell them apart.
   */
  const framed = targets.filter(
    (target) => check.frameId === undefined || target.frameId === check.frameId
  )
  const byName = namedBy(framed, (target) => target.accessibleName, check.name)
  /**
   * The check names the control in the user's words — "the editor" — and
   * the page labels it "Draft". A write of one control, bound to this
   * requirement, still stands for it when it held exactly the planned value:
   * the value, not the label, is what the check is for. Only an editing
   * host: a form field has a label the user's words name, and "Alice" typed
   * into Email is not the Name the check asks for. A batch never does,
   * because one of its several controls would have to be guessed.
   */
  const named =
    byName.length === 0 && framed.length === 1 && editingHost(framed[0].tag)
      ? framed
      : byName
  return (
    named.length === 1 &&
    !named[0].sensitive &&
    (check.type === "checked"
      ? named[0].expectedChecked === check.checked
      : named[0].expectedValue === check.value)
  )
}

/**
 * The one exact text a requirement quotes — "the editor holds exactly
 * “First paragraph.\nSecond paragraph.”" — with a written `\n` read as the
 * line break it names. Undefined when it quotes none, or more than one.
 */
export const agentQuotedLiteral = (text: string): string | undefined => {
  const quoted = [...text.matchAll(/["“”]([^"“”]+)["“”]/gu)].map(
    (match) => match[1]
  )
  return quoted.length === 1 ? quoted[0].replaceAll("\\n", "\n") : undefined
}

/**
 * Words asking for an act past the write itself: "Send the message “Hello”"
 * is not met by typing Hello, however exactly the field holds it.
 */
const PAST_WRITE_WORDS = new Set([
  "submit",
  "submitted",
  "send",
  "sent",
  "save",
  "saved",
  "post",
  "posted",
  "publish",
  "published",
  "search",
  "click",
  "press",
  "confirm",
  "apply",
  "reply"
])

/** Words that name no particular control: "the field" is any field. */
const UNBINDING_WORDS = new Set([
  "the",
  "and",
  "for",
  "into",
  "onto",
  "with",
  "this",
  "that",
  "your",
  "its",
  "from",
  "field",
  "box",
  "input",
  "text",
  "area",
  "control"
])

const unquotedWords = (text: string): string[] =>
  agentNormalizedClaim(text.replaceAll(/["“”][^"“”]+["“”]/gu, " "))
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3)

/**
 * A requirement with no check that quotes the exact text it wants, written
 * whole into one control and confirmed holding exactly that. The check the
 * planner left out is the quote itself. Only a requirement the value alone
 * answers — none to be kept or sent — and only for the control it names, or
 * an editing host, which its words describe rather than label.
 */
const heldQuotedLiteral = (
  requirement: AgentTaskRequirement,
  targets: readonly {
    accessibleName?: string
    tag?: string
    expectedValue?: string
    sensitive?: boolean
  }[],
  verification: { outcome: string; evidence: { kind: string } }
): boolean => {
  const literal = agentQuotedLiteral(requirement.text)
  if (
    literal === undefined ||
    requirement.persist === true ||
    verification.outcome !== "confirmed" ||
    !FIELD_WRITE_KINDS.has(verification.evidence.kind) ||
    targets.length !== 1 ||
    targets[0].sensitive ||
    targets[0].expectedValue !== literal
  )
    return false
  const words = unquotedWords(requirement.text)
  if (words.some((word) => PAST_WRITE_WORDS.has(word))) return false
  const name = unquotedWords(targets[0].accessibleName ?? "").filter(
    (word) => !UNBINDING_WORDS.has(word)
  )
  return (
    editingHost(targets[0].tag) ||
    name.some((word) => words.includes(word) && !UNBINDING_WORDS.has(word))
  )
}

/**
 * Whether a change with no check that quotes its exact text is met by the
 * run's own write: its last write for the requirement held the literal, and
 * that control is now either gone — saved or left behind — or still holds
 * exactly it. A later write that did not hold it, or the control holding
 * something else, leaves it to the quote and the reviewer.
 */
export const agentHeldLiteralStands = (
  requirement: AgentTaskRequirement,
  changes: readonly AgentStepReadout[],
  observation: AgentObservation
): boolean => {
  if (requirement.check || requirement.kind !== "change") return false
  const literal = agentQuotedLiteral(requirement.text)
  if (literal === undefined) return false
  /**
   * Checked again where it is read, not only where the write was recorded:
   * a receipt written before that rule existed still says nothing of a send.
   */
  if (
    requirement.persist === true ||
    unquotedWords(requirement.text).some((word) => PAST_WRITE_WORDS.has(word))
  )
    return false
  const writes = changes.filter(
    (step) =>
      step.requirementId === requirement.id &&
      FIELD_WRITE_KINDS.has(step.verification?.evidence.kind ?? "")
  )
  const last = writes.at(-1)
  if (last?.heldPlannedValue !== true || !last.target?.name) return false
  const name = last.target.name
  const present = observation.elements.filter(
    (element) => !element.sensitive && same(element.name ?? "", name)
  )
  if (present.length === 0)
    return changes
      .slice(changes.indexOf(last) + 1)
      .some((step) => leftThePage(step) || savedAway(step))
  return (
    present.length === 1 &&
    !present[0].invalid &&
    !present[0].valueTruncated &&
    present[0].value === literal
  )
}

/**
 * What can take a filled control off the page: the form was sent, or the
 * page navigated. A confirmed click or key press that left the field in
 * place proves nothing about where it went.
 */
const PAGE_LEAVING_KINDS = new Set(["submission", "navigation", "tab"])

/**
 * A followed link is verified as an `activation`, and so is a click that
 * stayed put; only the verifier's own sentence tells them apart. These are
 * the runtime's fixed wording for a click whose destination committed or
 * whose page opened in a tab of its own — never page text.
 */
export const AGENT_PAGE_LEAVING_ACTIVATIONS = new Set([
  "Authorized destination is committed",
  "The site redirected its own link within its origin",
  "Control opened a new tab"
])

const leftThePage = (step: AgentStepReadout): boolean => {
  const verification = step.verification
  if (verification?.outcome !== "confirmed") return false
  /** A form the site turned away left its fields where they were. */
  if (
    verification.evidence.kind === "submission" &&
    verification.evidence.acceptance !== "accepted"
  )
    return false
  return (
    PAGE_LEAVING_KINDS.has(verification.evidence.kind) ||
    (verification.evidence.kind === "activation" &&
      AGENT_PAGE_LEAVING_ACTIVATIONS.has(verification.evidence.summary))
  )
}

/**
 * Whether the page itself is the record's: its title names the record, and
 * no control of the checked name sits in a row of its own. Its text is no
 * answer: a breadcrumb or a "recently viewed" link names records the page
 * is not about.
 */
const pageOfRecord = (
  record: string,
  name: string,
  candidates: readonly AgentObservation["elements"][number][],
  observation: AgentObservation
): boolean =>
  !namedBy(candidates, (element) => element.name, name).some(
    (element) => element.rowContext
  ) && agentTextNamesRecord(observation.title, record)

/** An element that edits as a document rather than a labelled field. */
const editingHost = (tag: string | undefined): boolean =>
  tag !== undefined && !["input", "select", "textarea"].includes(tag)

/**
 * The label of the control this requirement's own writes held its planned
 * value in, when the check named it in other words: every such write, and
 * there may be a retype, went to one control of one name.
 */
const ownHeldWriteName = (
  requirementId: string,
  changes: readonly AgentStepReadout[]
): string | undefined => {
  const labels = new Set(
    changes
      .filter(
        (step) =>
          step.heldPlannedValue === true &&
          step.requirementId === requirementId &&
          step.verification?.evidence.kind === "field"
      )
      .map((step) => step.target?.name ?? "")
  )
  const [label] = [...labels]
  return labels.size === 1 && label ? label : undefined
}

/** A confirmed step whose grounded effect was a save or a send. */
const savedAway = (step: AgentStepReadout): boolean =>
  step.verification?.outcome === "confirmed" &&
  (step.consequential ?? []).some(
    (effect) =>
      effect === "save" ||
      effect === "submission" ||
      effect === "potential_commit"
  )

/**
 * A confirmed click whose only effect was to commit a destination: a link
 * followed, with no consequential class behind it.
 */
export const agentFollowedLink = (step: AgentStepReadout): boolean =>
  step.verification?.outcome === "confirmed" &&
  step.verification.evidence.kind === "activation" &&
  AGENT_PAGE_LEAVING_ACTIVATIONS.has(step.verification.evidence.summary) &&
  !step.consequential?.length

/** Steps that take the run to another page, whichever way. */
const MOVES = new Set(["navigate", "back", "open_tab", "switch_tab"])

/**
 * The link whose following opened the page a retained quote was read on:
 * the run's last move before the fact was read, when that move was a link
 * it followed. A shop's price line names only the kettle; the run reached
 * the page by clicking "Brew Bazaar", and its own receipt says so. Undefined
 * when the last move was anything else — a back, a typed address — because
 * then no click names the page.
 */
export const agentQuotePageLink = (
  quote: string | undefined,
  requirementId: string,
  ledger: readonly AgentEvidenceRecord[] | undefined,
  steps: readonly AgentStepReadout[] | undefined
): string | undefined =>
  agentFactPageLink(
    groundedCompletionQuote(quote, requirementId, ledger),
    steps
  )

/** The same, for one retained fact. */
export const agentFactPageLink = (
  fact: AgentEvidenceRecord | undefined,
  steps: readonly AgentStepReadout[] | undefined
): string | undefined => {
  if (!fact || !steps) return undefined
  const move = latestAgentSteps(steps)
    .filter(
      (step) =>
        step.verification?.outcome === "confirmed" &&
        step.at <= fact.observedAt &&
        (agentFollowedLink(step) ||
          leftThePage(step) ||
          MOVES.has(step.command?.type ?? ""))
    )
    .sort((first, second) => second.sequence - first.sequence)[0]
  return move && agentFollowedLink(move) ? move.target?.name : undefined
}

/**
 * A step that could have carried a form's values off with the page: a save
 * or a send by its grounded classes, or a press that was not a link. A
 * "Continue" posting a form is verified on the page change it made, with no
 * class behind it, and a GET form's button commits its destination like a
 * link does; a link itself, a typed address or a tab commits nothing.
 */
const committedWrite = (step: AgentStepReadout): boolean => {
  if (savedAway(step)) return true
  const verification = step.verification
  if (verification?.outcome !== "confirmed") return false
  const { evidence } = verification
  if (evidence.kind === "submission") return evidence.acceptance !== "rejected"
  if (evidence.kind !== "activation") return false
  const link = step.target?.role === "link" || step.target?.tag === "a"
  return !(link && agentFollowedLink(step))
}

/** Whether a confirmed write of either shape set a control of this name. */
const writesControlNamed = (step: AgentStepReadout, name: string): boolean => {
  const evidence = step.verification?.evidence
  if (evidence?.kind === "field" || evidence?.kind === "checked")
    return namedBy([step.target?.name], (label) => label, name).length === 1
  return (
    evidence?.kind === "fields" &&
    namedBy(evidence.fields ?? [], (field) => field.name, name).length === 1
  )
}

/**
 * A control the run filled and then moved on from is not on the page it moved
 * to. Its absence contradicts nothing when the run's last write to a control
 * of that name was verified holding exactly the planned value and a confirmed
 * submission or navigation came after it: the page left because the run
 * left it. A later write
 * to the same name replaces the earlier one, so a value cleared or retyped
 * before leaving is never credited.
 *
 * `credited` when it stands for the control, `unproven` when the run wrote
 * the control and left it without that record, undefined when the run never
 * left a control of that name behind. A run back on the page the write was
 * made on, with a control there the name still picks out, reads that
 * control: the form was reopened, and what it holds now is the answer.
 */
const plannedValueLeftBehind = (
  requirementId: string,
  name: string,
  changes: readonly AgentStepReadout[],
  currentUrl: string,
  present: boolean
): "credited" | "unproven" | undefined => {
  let last = -1
  for (const [index, step] of changes.entries())
    if (writesControlNamed(step, name)) last = index
  /**
   * No write to a control of that name: the requirement's own write that
   * held its planned value under the page's label instead (see
   * `agentWriteHeldPlannedValue`), when it is the only such write.
   */
  if (last < 0) {
    const label = ownHeldWriteName(requirementId, changes)
    if (label !== undefined)
      for (const [index, step] of changes.entries())
        if (writesControlNamed(step, label)) last = index
  }
  if (last < 0) return undefined
  const write = changes[last]
  const later = changes.slice(last + 1)
  /**
   * The page left when a later step says so, or when the run, after a later
   * change, is no longer on the page the write was made on. A save button
   * whose handler posts and then navigates is verified on the in-page change
   * it made first, so its own receipt never says it left; the address the
   * run is on now does.
   */
  /**
   * A confirmed save or send after the write, with the control now nowhere on
   * the page, took it away too. Saving an embedded widget navigates only its
   * frame: the address the run is on stays the same, and the fields it set
   * read as contradicted on the frame's confirmation page.
   */
  const left =
    later.some(leftThePage) ||
    (later.length > 0 &&
      write.sourceUrl !== undefined &&
      !samePageAddress(write.sourceUrl, currentUrl)) ||
    (!present && later.some(savedAway))
  if (!left) return undefined
  if (
    present &&
    write.sourceUrl !== undefined &&
    samePageAddress(write.sourceUrl, currentUrl)
  )
    return undefined
  /**
   * Leaving is not keeping. A value typed and then walked away from by a
   * followed link or a typed address was never sent anywhere: the page that
   * held it is gone and so is the value. Only a commit after the write — a
   * save, a send, or a press that changed the page and was not a link —
   * carried it off with the page.
   */
  if (!later.some(committedWrite)) return "unproven"
  return (write.heldPlannedValue === true &&
    write.requirementId === requirementId) ||
    write.heldPlannedFor?.includes(requirementId) === true
    ? "credited"
    : "unproven"
}

/** Same scheme, host and path, read by pattern: the package has no `URL`. */
const samePageAddress = (first: string, second: string): boolean => {
  const page = (url: string) => {
    const match = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)([^?#]*)/i.exec(url)
    return match ? `${match[1].toLowerCase()}${match[2] || "/"}` : undefined
  }
  const a = page(first)
  return a !== undefined && a === page(second)
}

/**
 * A select is read by its option, and the planner names the option the way
 * the page shows it. `value` is what the page submits, which is often a
 * lowercase key behind a capitalized label; the label the user sees is the
 * same option, so either identifies it. The option must still be the one
 * selected and must not be disabled.
 */
const selectedOptionMatches = (
  element: AgentObservation["elements"][number],
  wanted: string
): boolean =>
  element.options?.some(
    (option) =>
      option.value === element.value &&
      !option.disabled &&
      (option.value === wanted || same(option.label, wanted))
  ) === true

/**
 * A control's on/off state, whichever way the page declares it: a native
 * checkbox, then a custom one's `aria-checked`, a toggle button's
 * `aria-pressed`, a tab's or option's `aria-selected`. "mixed" is neither.
 */
export const agentControlOnState = (
  element: AgentObservation["elements"][number]
): boolean | undefined => {
  for (const state of [
    element.checked,
    element.ariaChecked,
    element.pressed,
    element.selected
  ])
    if (typeof state === "boolean") return state
  return undefined
}

/**
 * A custom listbox has no native options to read: its choice is the one
 * option marked selected in the listbox the control owns, which the
 * observation reads where ownership is known. Never another listbox's
 * selection in the same frame, and never the text a combobox holds: typing
 * "Blue" into an autocomplete picks nothing.
 */
const ariaSelectionMatches = (
  element: AgentObservation["elements"][number],
  wanted: string
): boolean =>
  element.selectedOption !== undefined && same(element.selectedOption, wanted)

type ControlTransitionCheck = Extract<
  NonNullable<AgentTaskRequirement["check"]>,
  { type: "control_transition" }
>

const checkControlTransition = (
  requirementId: string,
  check: ControlTransitionCheck,
  observation: AgentObservation,
  changes: readonly AgentStepReadout[]
): boolean | undefined => {
  /**
   * Row context is whole-row text, so finding the record's name inside it
   * cannot tell "Record 1" from "Record 1 copy". A row proves ownership only
   * when what it says besides the control's own label is exactly the
   * record; anything less is left to independent review, never decided
   * either way.
   */
  const ownsRecord = (name: string | undefined, row: string | undefined) =>
    !check.record || same(agentRowContextBeyond(name, row) ?? "", check.record)
  const undecided = check.record ? undefined : false
  if (same(check.from, check.to)) return false
  const after = observation.elements.filter(
    (element) =>
      !element.sensitive &&
      (element.visible || element.offscreen) &&
      same(element.name ?? "", check.to) &&
      (check.frameId === undefined || element.frameId === check.frameId) &&
      ownsRecord(element.name, element.rowContext)
  )
  if (after.length !== 1) return undecided
  const proved = changes.some(
    (step) =>
      step.verification?.outcome === "confirmed" &&
      step.requirementId === requirementId &&
      same(
        step.verification.evidence.controlTransition?.from ?? "",
        check.from
      ) &&
      same(step.verification.evidence.controlTransition?.to ?? "", check.to) &&
      after[0].verificationId ===
        step.verification.evidence.controlTransition?.verificationId &&
      after[0].frameId ===
        step.verification.evidence.controlTransition?.frameId &&
      observation.documentId ===
        step.verification.evidence.controlTransition?.documentId &&
      ownsRecord(step.target?.name, step.target?.rowContext)
  )
  return proved || undecided
}

/** Undefined is a semantic claim; false is a predicate we could not prove. */
const readCheck = (
  requirement: AgentTaskRequirement,
  observation: AgentObservation,
  ledger: readonly AgentEvidenceRecord[] | undefined,
  quote: string | undefined,
  changes: readonly AgentStepReadout[]
): boolean | "unreadable" | undefined => {
  const check = requirement.check
  if (!check) return undefined
  if (check.type === "url") return observation.url === check.url
  if (check.type === "control_transition")
    return checkControlTransition(requirement.id, check, observation, changes)
  if (check.type === "record_state") {
    const fact = groundedCompletionQuote(quote, requirement.id, ledger, true)
    if (!fact?.source) return "unreadable"
    const frame = observation.frames.find(
      (entry) => entry.frameId === fact.source?.frameId
    )
    if (
      fact.source.tabId !== observation.tabId ||
      frame?.access !== "ok" ||
      frame.documentId !== fact.source.documentId ||
      frame.snapshotId !== fact.source.snapshotId ||
      frame.generation !== fact.source.generation
    )
      return "unreadable"
    const record = escapePattern(agentNormalizedClaim(check.record))
    const status = observation.elements.some(
      (element) =>
        !element.sensitive &&
        (element.visible || element.offscreen) &&
        element.frameId === fact.source?.frameId &&
        same(element.name ?? "", fact.quote ?? "") &&
        (element.role === "status" || element.role === "alert")
    )
    if (!status) return undefined
    // Exact identity and asserted state together. "not saved" and another
    // row's status cannot satisfy this predicate. Other phrasing needs review.
    const said = agentNormalizedClaim(fact.quote ?? "")
    if (
      new RegExp(
        `^(?:${record}\\s*[:—–-]?\\s*(?:is\\s+)?${check.state}|${check.state}\\s*[:—–-]?\\s*${record})[.!]?$`,
        "u"
      ).test(said)
    )
      return true
    /**
     * A status naming the record and saying it failed contradicts the
     * check. Any other wording — "Order placed for Blue Kettle" against
     * "Blue Kettle order is submitted" — is a phrasing no rule here reads,
     * not a contradiction, and goes to review.
     */
    return new RegExp(`\\b${record}\\b`, "u").test(said) &&
      /\b(?:not|failed|failure|error|unable|could not|cannot|rejected|declined)\b/u.test(
        said
      )
      ? false
      : undefined
  }
  if (check.type === "row") {
    if (
      observation.elements.some(
        (element) =>
          !element.sensitive &&
          (element.visible || element.offscreen) &&
          (element.role === "row" ||
            element.role === "listitem" ||
            element.tag === "tr") &&
          same(element.name ?? "", check.record)
      )
    )
      return true
    return undefined
  }
  const candidates = observation.elements.filter(
    (element) =>
      !element.sensitive &&
      (element.visible || element.offscreen) &&
      (check.frameId === undefined || element.frameId === check.frameId)
  )
  /**
   * rowContext is bounded whole-row text, not a distinct record label, so it
   * cannot prove a control in a row belongs to the requested record. A form
   * whose fields sit in no row is about the record its page names — the Name
   * field of "Application for Record 4" — and is read as an unscoped check
   * there; anywhere else a record-scoped check goes to review.
   */
  if (
    check.record &&
    !pageOfRecord(check.record, check.name, candidates, observation)
  )
    return undefined
  /**
   * The control left with the page: a box ticked before Continue is not on
   * the page Continue opened. Its own confirmed write, recorded as holding
   * the planned value or state, stands for it there, and nothing else does.
   * Decided before a shortened name is read as a phrase, or "Email me the
   * terms" on the new page would answer for the "terms" box the run ticked
   * on the old one.
   */
  const matches = namedBy(candidates, (element) => element.name, check.name)
  const own =
    matches.length === 0 ? ownHeldWriteName(requirement.id, changes) : undefined
  if (!candidates.some((element) => same(element.name ?? "", check.name))) {
    /**
     * The write held the check under the page's label — the user's "editor"
     * is the page's "Draft" — so a control of that label is the control, and
     * one back on the page the write was made on is read, not credited as
     * one a save took away.
     */
    const left = plannedValueLeftBehind(
      requirement.id,
      check.name,
      changes,
      observation.url,
      matches.length > 0 ||
        (own !== undefined &&
          candidates.some((element) => same(element.name ?? "", own)))
    )
    if (left) return left === "credited"
  }
  const read = own
    ? candidates.filter((element) => same(element.name ?? "", own))
    : matches
  /** None is the value gone; two of one name is a page that cannot say which. */
  if (read.length !== 1) return read.length === 0 ? false : "unreadable"
  const element = read[0]
  /** The page rejected what the control holds; it does not hold it as asked. */
  if (element.invalid) return "unreadable"
  if (check.type === "checked")
    return agentControlOnState(element) === check.checked
  if (element.valueTruncated) return "unreadable"
  if (check.type === "selected")
    return element.options
      ? selectedOptionMatches(element, check.value)
      : ariaSelectionMatches(element, check.value)
  return element.value === check.value
}

/**
 * Whether the check holds on this observation: true or false when the page
 * answers it, undefined when it cannot be read as one. A false here is also
 * a page that refused to answer — two controls of one name, a value cut
 * short, a control the page marks invalid, a quote not read on this page —
 * which `agentCheckFailureUnreadable` tells apart.
 */
export const checkCompletionState = (
  requirement: AgentTaskRequirement,
  observation: AgentObservation,
  ledger: readonly AgentEvidenceRecord[] | undefined,
  quote: string | undefined,
  changes: readonly AgentStepReadout[] = []
): boolean | undefined => {
  const held = readCheck(requirement, observation, ledger, quote, changes)
  return held === "unreadable" ? false : held
}

/**
 * Whether a check failed because the page could not answer it rather than
 * because it showed the value missing or another one in its place: then
 * nothing says a save was lost, and "re-apply it" would repeat a kept change.
 */
export const agentCheckFailureUnreadable = (
  requirement: AgentTaskRequirement,
  observation: AgentObservation,
  ledger: readonly AgentEvidenceRecord[] | undefined,
  quote: string | undefined,
  changes: readonly AgentStepReadout[] = []
): boolean =>
  readCheck(requirement, observation, ledger, quote, changes) === "unreadable"
