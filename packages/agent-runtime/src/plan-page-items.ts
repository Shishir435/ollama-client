import {
  type AgentEvidenceRecord,
  type AgentObservation,
  type AgentTaskConstraint,
  type AgentTaskRequirement,
  MAX_AGENT_PLAN_ITEMS,
  MAX_AGENT_REQUIREMENT_ITEM_CHARS,
  MAX_AGENT_REQUIREMENT_ITEM_LINK_CHARS,
  MAX_AGENT_REQUIREMENT_ITEMS
} from "@ollama-client/contracts"
import { agentStepSourceUrl } from "./history"
import type { AgentStepReadout } from "./ports"
import { agentTextNamesRecord } from "./row-context"

/**
 * "Open every source link", "visit all the links", "go to each link in a new
 * tab": an act of opening, a quantifier, up to three words, then the word
 * link. The words between the quantifier and "link" are the qualifier.
 *
 * The act is part of the match because a tab is all a page item's receipt
 * can prove. "Upvote every link" or "bookmark all the links" owes something
 * done on each one; opening their tabs does none of it, so such a requirement
 * binds nothing here and is judged per item like any other.
 */
const OPEN_ACT = String.raw`(?:(?:open|visit|view|load|follow)(?:s|ed|ing)?|brows(?:e|es|ed|ing)|(?:go|goes|going)\s+(?:to|through)|navigat(?:e|es|ed|ing)\s+to)`
const LINK_QUANTIFIER = new RegExp(
  String.raw`(?:^|[^\p{L}\p{N}])${OPEN_ACT}(?:\s+up)?\s+(?:every|all|each)((?:\s+[\p{L}\p{N}'-]+){0,3}?)\s+links?(?![\p{L}\p{N}])`,
  "iu"
)

/** Words that sit between a quantifier and "links" without narrowing it. */
const UNQUALIFYING = new Set([
  "a",
  "an",
  "its",
  "of",
  "the",
  "their",
  "these",
  "this",
  "those",
  "that"
])

const normalized = (text: string): string => text.replaceAll(/\s+/g, " ").trim()

/** Lowercased words, so "Source/1" and "source-2" both carry "source". */
const words = (text: string): string[] =>
  text
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

/** A plural's stem: "sources" carries the "sourc" that "source" starts with. */
const stem = (word: string): string => {
  const bare = word.replace(/(?:'s|ies|es|s)$/u, "")
  return bare.length >= 3 ? bare : word
}

/**
 * The qualifier the user's words put on "links", as stems, or undefined when
 * the words do not ask for every link to be opened.
 *
 * Only `source` is read: the user's own words, checked against the goal when
 * the plan was parsed. `text` is the planner's restatement, and a planner
 * that turned "open the two source links" into "every source link" must not
 * thereby bind every link the page shows.
 */
const linkQuantifier = (
  requirement: AgentTaskRequirement
): string[] | undefined => {
  const match = requirement.source
    ? LINK_QUANTIFIER.exec(requirement.source)
    : null
  if (!match) return undefined
  return words(match[1] ?? "")
    .filter((word) => !UNQUALIFYING.has(word))
    .map(stem)
}

/**
 * Whether the user's words ask for every link opened: the only requirement a
 * confirmed tab can credit item by item. A page-item entry whose source says
 * anything else is judged on its items like a planner's own.
 */
export const agentRequirementOpensLinks = (
  requirement: AgentTaskRequirement
): boolean =>
  requirement.itemsFrom === "page" && linkQuantifier(requirement) !== undefined

const HTTP_URL = /^https?:\/\//i
const withoutFragment = (url: string): string => url.split("#", 1)[0]
const pathOf = (url: string): string =>
  /^https?:\/\/[^/?#]+([^?#]*)/i.exec(url)?.[1] ?? ""

interface PageLink {
  name: string
  href: string
}

/**
 * The distinct links the page's root frame shows: named, visible, not a
 * download and not the page itself or a place inside it. One entry per
 * address; a second element for the same address — an image and its caption
 * — is the same link.
 */
const pageLinks = (observation: AgentObservation): PageLink[] => {
  const root =
    observation.frames.find((frame) => frame.parentFrameId === undefined)
      ?.frameId ?? observation.frames[0]?.frameId
  const self = withoutFragment(observation.url)
  const links = new Map<string, PageLink>()
  for (const element of observation.elements) {
    if (
      element.frameId !== root ||
      !element.href ||
      !element.visible ||
      element.sensitive ||
      element.download ||
      !HTTP_URL.test(element.href)
    )
      continue
    const href = withoutFragment(element.href)
    const name = normalized(element.name ?? "")
    if (!name || href === self || links.has(href)) continue
    links.set(href, { name, href })
  }
  return [...links.values()]
}

const carriesQualifier = (link: PageLink, qualifier: readonly string[]) => {
  const tokens = [...words(link.name), ...words(pathOf(link.href))]
  return qualifier.every((part) =>
    tokens.some((token) => token.startsWith(part))
  )
}

/**
 * The items one quantified requirement owes, read off the page, or undefined
 * when the page cannot say: no link matches, two links share a name (which
 * "Read more" is the item?), a name is too long to be an item, or there are
 * more than one requirement may carry.
 */
const pageItemsFor = (
  qualifier: readonly string[],
  links: readonly PageLink[],
  constraints: readonly AgentTaskConstraint[]
): { items: string[]; itemLinks?: string[] } | undefined => {
  const excluded = constraints.filter(
    (constraint) => constraint.kind === "exclude"
  )
  const owed = links.filter(
    (link) =>
      carriesQualifier(link, qualifier) &&
      /** A link the user excluded is never owed, whatever the quantifier. */
      !excluded.some((constraint) =>
        agentTextNamesRecord(constraint.text, link.name)
      )
  )
  if (!owed.length || owed.length > MAX_AGENT_REQUIREMENT_ITEMS) return
  const names = owed.map((link) => link.name)
  if (
    names.some((name) => name.length > MAX_AGENT_REQUIREMENT_ITEM_CHARS) ||
    new Set(names.map((name) => name.toLocaleLowerCase())).size !== names.length
  )
    return
  const addresses = owed.map((link) =>
    agentStepSourceUrl(link.href)?.slice(
      0,
      MAX_AGENT_REQUIREMENT_ITEM_LINK_CHARS
    )
  )
  /**
   * Origin and path, the form a receipt keeps an address in. Links told
   * apart only by their query would share one; then no link is kept and the
   * names alone stand.
   */
  const distinct =
    addresses.every((address) => address !== undefined) &&
    new Set(addresses).size === addresses.length
  return {
    items: names,
    ...(distinct ? { itemLinks: addresses as string[] } : {})
  }
}

/**
 * The first plan, with the links a quantified outcome owes named as its
 * items.
 *
 * Planning happens before the run has looked at anything, so "open every
 * source link" reaches the first observation as one outcome naming nothing.
 * Measured live: a run opened both source links and was refused every
 * completion, because nothing said which pages "every" meant. The starting
 * page says: it is the page the user pointed at.
 *
 * The items are the page's words, so they are bound only to enumerate the
 * user's own quantifier — every, all or each, then links, with any qualifier
 * between them filtering by the link's name or path — and never widen it: a
 * link the qualifier does not name, or a constraint excludes, is not owed,
 * and an ambiguous page binds nothing. Only a first-plan entry with no items
 * of its own. Undefined when nothing was bound.
 */
export const agentPlanWithPageLinks = (
  requirements: readonly AgentTaskRequirement[],
  observation: AgentObservation,
  constraints: readonly AgentTaskConstraint[] = []
): AgentTaskRequirement[] | undefined => {
  let total = requirements.reduce(
    (sum, requirement) => sum + (requirement.items?.length ?? 0),
    0
  )
  let links: PageLink[] | undefined
  let bound = false
  const next = requirements.map((requirement) => {
    if (
      requirement.items?.length ||
      requirement.itemsFrom !== undefined ||
      (requirement.since ?? 1) > 1
    )
      return requirement
    const qualifier = linkQuantifier(requirement)
    if (!qualifier) return requirement
    links ??= pageLinks(observation)
    const page = pageItemsFor(qualifier, links, constraints)
    if (!page || total + page.items.length > MAX_AGENT_PLAN_ITEMS)
      return requirement
    total += page.items.length
    bound = true
    return { ...requirement, ...page, itemsFrom: "page" as const }
  })
  return bound ? next : undefined
}

/**
 * An amended plan keeps the page's provenance on an entry whose items it left
 * as they were. The planner restates entries without it; a page-written item
 * dropped of its mark would read as one the user named.
 */
export const agentPageItemsCarried = (
  previous: readonly AgentTaskRequirement[] | undefined,
  next: readonly AgentTaskRequirement[]
): AgentTaskRequirement[] =>
  next.map((requirement) => {
    const prior = previous?.find(
      (entry) => entry.id === requirement.id && entry.itemsFrom === "page"
    )
    if (
      !prior ||
      requirement.itemsFrom !== undefined ||
      requirement.items?.length !== prior.items?.length ||
      requirement.items?.some((item, index) => item !== prior.items?.[index])
    )
      return requirement
    return {
      ...requirement,
      itemsFrom: "page" as const,
      ...(prior.itemLinks ? { itemLinks: prior.itemLinks } : {})
    }
  })

/**
 * Whether a verified tab receipt is the opening of this page item: bound to
 * the item's own requirement, and committed at the item's link. A tab receipt
 * names no item in words, so its destination is what says which one.
 */
export const agentTabOpensPageItem = (
  record: AgentEvidenceRecord,
  requirement: AgentTaskRequirement,
  index: number
): boolean => {
  const link = requirement.itemLinks?.[index]
  return (
    link !== undefined &&
    agentRequirementOpensLinks(requirement) &&
    record.kind === "verified_effect" &&
    record.verificationKind === "tab" &&
    record.requirementId === requirement.id &&
    (record.validity === "current" || record.validity === "historical") &&
    record.destination === link
  )
}

/**
 * Whether a step receipt is the opening of this page item: a confirmed
 * `open_tab`, tagged for the item's own requirement, whose address is the
 * item's link. The judge reads receipts rather than the ledger, which may
 * have let an old receipt go; the receipt row is durable.
 */
export const agentReceiptOpensPageItem = (
  receipt: AgentStepReadout,
  requirement: AgentTaskRequirement,
  index: number
): boolean => {
  const link = requirement.itemLinks?.[index]
  return (
    link !== undefined &&
    agentRequirementOpensLinks(requirement) &&
    receipt.status === "verified" &&
    receipt.command?.type === "open_tab" &&
    receipt.verification?.outcome === "confirmed" &&
    receipt.verification.evidence.kind === "tab" &&
    receipt.requirementId === requirement.id &&
    agentStepSourceUrl(receipt.command.url)?.slice(
      0,
      MAX_AGENT_REQUIREMENT_ITEM_LINK_CHARS
    ) === link
  )
}
