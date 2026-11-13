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
import { agentStepSourceUrl, latestAgentSteps } from "./history"
import type { AgentStepReadout } from "./ports"
import { agentTextNamesRecord } from "./row-context"

/**
 * "every source link", "all the links", "each link": a quantifier, up to
 * three words, then the word link. The words between are the qualifier.
 *
 * Read on a requirement's own `text` and nothing else. Whether the
 * user's words mean only opening the links is not decided here: page items
 * are an enumeration of "every", never a credit, so the completion reviewer
 * judges what each item owes. A mis-binding can add a list for the reviewer
 * to read, never a completion.
 */
const LINK_QUANTIFIER =
  /(?:^|[^\p{L}\p{N}])(?:every|all|each)((?:\s+[\p{L}\p{N}'-]+){0,3}?)\s+links?(?![\p{L}\p{N}])/iu

/** A stated number of linked candidates is a closed collection, not names. */
const countedLinks = (requirement: AgentTaskRequirement) => {
  if (requirement.kind !== "read") return undefined
  const match =
    /\b(two|three|four|five|six|seven|eight|nine|ten|\d+)\s+([\p{L}]+)\s+linked\s+(?:on\s+(?:this|the)\s+page|here)\b/iu.exec(
      requirement.text
    )
  if (!match) return undefined
  const numbers = [
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten"
  ]
  const number = numbers.indexOf(match[1].toLowerCase())
  return {
    count: number < 0 ? Number(match[1]) : number + 2,
    qualifier: [stem(match[2].toLowerCase())]
  }
}

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
 * The qualifier a requirement's own text puts on "links", as stems,
 * or undefined when the text quantifies no links.
 */
const linkQualifier = (
  requirement: AgentTaskRequirement
): string[] | undefined => {
  const counted = countedLinks(requirement)
  if (counted) return counted.qualifier
  const match =
    LINK_QUANTIFIER.exec(requirement.text) ??
    (requirement.kind === "read"
      ? /(?:^|[^\p{L}\p{N}])(?:every|all|each)((?:\s+[\p{L}\p{N}'-]+){0,3}?)\s+pages?(?![\p{L}\p{N}])/iu.exec(
          requirement.text
        )
      : null)
  if (!match) return undefined
  /** "all linked pages" and "all pages linked here" name the same collection. */
  if (
    requirement.kind === "read" &&
    !LINK_QUANTIFIER.test(requirement.text) &&
    !/\blinked\b/iu.test(match[1]) &&
    !/^\s+linked(?![\p{L}\p{N}])/iu.test(
      requirement.text.slice(match.index + match[0].length)
    )
  )
    return undefined
  return words(match[1] ?? "")
    .filter(
      (word) =>
        !UNQUALIFYING.has(word) &&
        !(requirement.kind === "read" && word === "linked")
    )
    .map(stem)
}

/** Only explicitly quantified links/linked pages form this bounded collection. */
export const agentQuantifiedPageRead = (
  requirement: AgentTaskRequirement
): boolean =>
  requirement.kind === "read" && linkQualifier(requirement) !== undefined

const HTTP_URL = /^https?:\/\//i
const withoutFragment = (url: string): string => url.split("#", 1)[0]
const pathOf = (url: string): string =>
  /^https?:\/\/[^/?#]+([^?#]*)/i.exec(url)?.[1] ?? ""

interface PageLink {
  name: string
  href: string
  /** Query/fragment identity cannot survive the bounded address format. */
  unstableIdentity?: boolean
}

/**
 * The distinct links the page's root frame shows: named, visible, not a
 * download and not the page itself or a place inside it. One entry per
 * address; a second element for the same address — an image and its caption
 * — is the same link.
 *
 * `hidden` names the links laid out below the fold. An observation withholds
 * their destinations, so they cannot be items, but they are links "every"
 * still covers: a list that leaves them out is not the whole list.
 */
const pageLinks = (
  observation: AgentObservation
): { links: PageLink[]; hidden: string[]; unresolved: boolean } => {
  const root =
    observation.frames.find((frame) => frame.parentFrameId === undefined)
      ?.frameId ?? observation.frames[0]?.frameId
  const self = withoutFragment(observation.url)
  const links = new Map<string, PageLink>()
  const hidden: string[] = []
  let unresolved = false
  for (const element of observation.elements) {
    const name = normalized(element.name ?? "")
    if (
      element.frameId === root &&
      element.visible &&
      element.role === "link" &&
      !element.href &&
      !element.sensitive &&
      !element.download
    )
      unresolved = true
    if (
      element.frameId === root &&
      element.offscreen &&
      element.role === "link" &&
      !element.sensitive &&
      !element.download
    ) {
      hidden.push(name)
      continue
    }
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
    if (!name || href === self) continue
    const unstableIdentity = /[?#]/u.test(element.href)
    const duplicate = links.get(href)
    if (duplicate) {
      if (unstableIdentity) duplicate.unstableIdentity = true
      continue
    }
    links.set(href, {
      name,
      href,
      ...(unstableIdentity ? { unstableIdentity } : {})
    })
  }
  return { links: [...links.values()], hidden, unresolved }
}

const carriesQualifier = (link: PageLink, qualifier: readonly string[]) => {
  const tokens = [...words(link.name), ...words(pathOf(link.href))]
  return qualifier.every((part) =>
    tokens.some((token) => token.startsWith(part))
  )
}

/** Wording that leaves a source out of what is read, not out of what is done. */
const EXCLUDES_READING =
  /\b(?:skip|ignore|except|excluding|exclude|other than|leave out|leave aside|apart from|(?:do not|don't|dont|never|without) (?:read|open|visit|check|review|include|count|look at|consider))\b/iu

/**
 * The items one quantified requirement owes, read off the page, or undefined
 * when the page cannot say: no link matches, a matching link sits below the
 * fold where its address is withheld, two links share a name (which "Read
 * more" is the item?), a name is too long to be an item, or there are more
 * than one requirement may carry.
 */
const pageItemsFor = (
  qualifier: readonly string[],
  { links, hidden }: ReturnType<typeof pageLinks>,
  constraints: readonly AgentTaskConstraint[],
  reading: boolean
): { items: string[]; itemLinks?: string[] } | undefined => {
  /**
   * A read is narrowed only by an exclusion of reading itself: "do not buy
   * Offer Blue" rules out a purchase, and Offer Blue is still a source the
   * user asked to have read.
   */
  const excluded = constraints.filter(
    (constraint) =>
      constraint.kind === "exclude" &&
      (!reading ||
        (!constraint.forbids?.length && EXCLUDES_READING.test(constraint.text)))
  )
  /**
   * The path is withheld and may carry the qualifier even when the name
   * does not. Any below-fold link leaves the list to the reviewer rather
   * than binding a subset whose completeness the observation cannot prove.
   */
  if (hidden.length) return
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
 * The items are the page's words, so they only enumerate the quantifier a
 * entry's own text carries — every, all or each, then links, with any
 * qualifier between them filtering by the link's name or path — and never
 * widen it: a link the qualifier does not name, or a constraint excludes, is
 * not owed. Changes bind only without planner items. Reads additionally
 * require complete, unambiguous enumeration; unknown coverage is explicit.
 * This is a starting-page snapshot, not recursive or paginated discovery.
 * Undefined when nothing was bound.
 *
 * Nothing here reads what each link owes. The items credit nothing by
 * themselves: the judge meets a page-item change from tabs only when the
 * outcome asks for nothing but the opening and the browser lists each tab
 * open, and otherwise the completion reviewer decides whether a tab record
 * is all an item asked for.
 */
export const agentPlanWithPageLinks = (
  requirements: readonly AgentTaskRequirement[],
  observation: AgentObservation,
  constraints: readonly AgentTaskConstraint[] = [],
  /**
   * Reads an amendment added that the user's own words point at this page;
   * see `agentAmendedPageReads`. After the first look only these are bound:
   * every other entry's collection was the starting page's.
   */
  amendedReads: ReadonlySet<string> = new Set(),
  firstLook = true
): AgentTaskRequirement[] | undefined => {
  let total = requirements.reduce(
    (sum, requirement) => sum + (requirement.items?.length ?? 0),
    0
  )
  let links: ReturnType<typeof pageLinks> | undefined
  let bound = false
  const next = requirements.map((requirement) => {
    const reading = agentQuantifiedPageRead(requirement)
    /**
     * A planner's `itemsFrom` with no items names nothing to keep: one wrote
     * `itemsFrom: "page"` on an outcome it gave no items, and the page's
     * links were never bound to it.
     */
    const amendedRead = reading && amendedReads.has(requirement.id)
    if (
      (!firstLook && !amendedRead) ||
      (!reading && requirement.items?.length) ||
      ((requirement.since ?? 1) > 1 && !amendedRead)
    )
      return requirement
    const qualifier = linkQualifier(requirement)
    if (!qualifier) return requirement
    const collection = (links ??= pageLinks(observation))
    const page = pageItemsFor(qualifier, collection, constraints, reading)
    const incompleteRead = () => {
      if (!reading) return requirement
      bound = true
      return { ...requirement, pageItemsComplete: false }
    }
    const existing = requirement.items?.length ?? 0
    if (!page || total - existing + page.items.length > MAX_AGENT_PLAN_ITEMS)
      return incompleteRead()
    if (
      reading &&
      ((countedLinks(requirement) &&
        page.items.length !== countedLinks(requirement)!.count) ||
        observation.elementsPartial ||
        collection.unresolved ||
        !page.itemLinks ||
        page.itemLinks.some(
          (address, index) =>
            address.length >= MAX_AGENT_REQUIREMENT_ITEM_LINK_CHARS ||
            collection.links.find((link) => link.name === page.items[index])
              ?.unstableIdentity
        ) ||
        (requirement.items &&
          (requirement.items.length !== page.items.length ||
            requirement.items.some(
              (item, index) => item !== page.items[index]
            ))) ||
        observation.elements.some(
          (element) =>
            (element.visible || element.offscreen) &&
            /^(?:next(?: page)?|load more|show more|more results)$/iu.test(
              element.name?.trim() ?? ""
            )
        ))
    )
      return incompleteRead()
    total += page.items.length - existing
    bound = true
    return {
      ...requirement,
      ...page,
      itemsFrom: "page" as const,
      ...(reading ? { pageItemsComplete: true } : {})
    }
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
      (entry) =>
        entry.id === requirement.id &&
        (entry.itemsFrom === "page" || entry.pageItemsComplete !== undefined)
    )
    if (
      !prior ||
      requirement.itemsFrom !== undefined ||
      requirement.items?.length !== prior.items?.length ||
      requirement.items?.some((item, index) => item !== prior.items?.[index])
    )
      return previous && unenumerated(requirement, previous)
        ? { ...requirement, pageItemsComplete: false }
        : requirement
    /**
     * Completeness was judged for the old wording's collection: "every
     * eligible offer link" is not the list "every offer link" enumerated.
     * The items and links stay; coverage of the new criterion is unknown.
     */
    const reworded = normalized(requirement.text) !== normalized(prior.text)
    return {
      ...requirement,
      ...(prior.itemsFrom ? { itemsFrom: prior.itemsFrom } : {}),
      ...(prior.pageItemsComplete !== undefined
        ? { pageItemsComplete: reworded ? false : prior.pageItemsComplete }
        : {}),
      ...(prior.itemLinks ? { itemLinks: prior.itemLinks } : {})
    }
  })

/**
 * A quantified read the amendment adds, or rewords into one, after the run
 * left the page the collection is enumerated from. Only the starting page is
 * the user's pointer to "every link here"; any later page is one the run
 * chose, so its links cannot be bound as what the user meant. The read is
 * marked as of unknown coverage, which completion reports as unmet rather
 * than leaving the plan waiting on metadata nothing will write.
 */
const unenumerated = (
  requirement: AgentTaskRequirement,
  previous: readonly AgentTaskRequirement[]
): boolean =>
  requirement.pageItemsComplete === undefined &&
  agentQuantifiedPageRead(requirement) &&
  !previous.some(
    (entry) =>
      entry.id === requirement.id &&
      normalized(entry.text) === normalized(requirement.text)
  )

/**
 * The user's words point at the page in front of them. "The page" is not
 * such a pointer: "the page I sent earlier" names another one.
 */
const POINTS_HERE =
  /(?:^|[^\p{L}\p{N}])(?:here|this page|on this site|this site)(?![\p{L}\p{N}])/iu
/** Words that may point back at a page other than the current one. */
const POINTS_ELSEWHERE =
  /(?:^|[^\p{L}\p{N}])(?:earlier|previous(?:ly)?|prior|original|other|another|that page|last page|first page|(?:page|site|tab|document)\s+before\s+(?:this|that)\s+(?:one|page|site|tab|document)|(?:sent|shared|shown|showed|opened|visited|provided|used|linked|gave|given|saw|seen|found|read|mentioned|cited|referenced|pointed)(?:\s+(?:to|with|you|me|us|at)){0,3}\s+before)(?![\p{L}\p{N}])/iu
/** Commands that only look; anything else may have left the page. */
const LOOKING = new Set([
  "look",
  "find",
  "inspect",
  "extract_text",
  "scroll",
  "wait",
  "zoom"
])

/**
 * The quantified reads an amendment adds whose collection the current page
 * demonstrably is, so their links may be enumerated from it. Each must be
 * of unknown coverage and name no items yet, and its `source` must be the
 * user's own words from one answer, pointing at the page ("every source
 * link here"). The page is the one meant only if nothing the run did since
 * that answer could have left it: any step other than looking, at or after
 * the answer, leaves the read unknown and reported unmet — never complete.
 * Without receipts nothing is enumerated.
 */
export const agentAmendedPageReads = (
  previous: readonly AgentTaskRequirement[] | undefined,
  amended: readonly AgentTaskRequirement[],
  answers: readonly { text: string; answeredAt: number }[] | undefined,
  receipts: readonly AgentStepReadout[] | undefined
): Set<string> => {
  const ids = new Set<string>()
  if (!previous || !receipts) return ids
  for (const requirement of amended) {
    const source = requirement.source && normalized(requirement.source)
    if (
      !source ||
      requirement.pageItemsComplete !== false ||
      requirement.items?.length ||
      !agentQuantifiedPageRead(requirement) ||
      !unenumerated(
        { ...requirement, pageItemsComplete: undefined },
        previous
      ) ||
      !POINTS_HERE.test(source) ||
      POINTS_ELSEWHERE.test(source)
    )
      continue
    const said = (answers ?? []).filter((answer) =>
      normalized(answer.text)
        .toLocaleLowerCase()
        .includes(source.toLocaleLowerCase())
    )
    if (said.length !== 1) continue
    const since = said[0].answeredAt
    const moved = receipts.some(
      (step) =>
        step.status !== "rejected" &&
        step.at >= since &&
        step.command !== undefined &&
        !LOOKING.has(step.command.type)
    )
    if (!moved) ids.add(requirement.id)
  }
  return ids
}

/**
 * A tab at a page item's own link is that item's by its address, whether or
 * not the run tagged it: the link is what names the item. Measured live: a
 * run told to keep a page's quotes before leaving re-sent its second
 * `open_tab` with the quotes and without the tag, and its outcome could never
 * reach review. A tab tagged for another outcome is that outcome's.
 */
const servesItsRequirement = (
  tagged: string | undefined,
  requirement: AgentTaskRequirement
): boolean => tagged === undefined || tagged === requirement.id

/**
 * Whether a verified tab record cites this page item: bound to the item's
 * own requirement or to none, and committed at the item's link. A tab record names no
 * item in words, so its destination is what says which one. This is only
 * the shape of a citation; the reviewer's verdict decides whether opening
 * the page is all the item asked for.
 */
export const agentTabOpensPageItem = (
  record: AgentEvidenceRecord,
  requirement: AgentTaskRequirement,
  index: number
): boolean => {
  const link = requirement.itemLinks?.[index]
  return (
    link !== undefined &&
    requirement.itemsFrom === "page" &&
    record.kind === "verified_effect" &&
    record.verificationKind === "tab" &&
    servesItsRequirement(record.requirementId, requirement) &&
    (record.validity === "current" || record.validity === "historical") &&
    record.destination === link
  )
}

/**
 * Whether a step receipt is the opening of this page item: a confirmed
 * `open_tab`, tagged for the item's own requirement or untagged, whose
 * address is the item's link. Gated on page provenance alone, never on reading what the
 * outcome's verbs ask for: the receipt only lets the requirement reach the
 * reviewer, which decides whether a tab is all the item owes.
 */
export const agentReceiptOpensPageItem = (
  receipt: AgentStepReadout,
  requirement: AgentTaskRequirement,
  index: number
): boolean => {
  const link = requirement.itemLinks?.[index]
  return (
    link !== undefined &&
    requirement.itemsFrom === "page" &&
    receipt.status === "verified" &&
    receipt.command?.type === "open_tab" &&
    receipt.verification?.outcome === "confirmed" &&
    receipt.verification.evidence.kind === "tab" &&
    servesItsRequirement(receipt.requirementId, requirement) &&
    agentStepSourceUrl(receipt.command.url)?.slice(
      0,
      MAX_AGENT_REQUIREMENT_ITEM_LINK_CHARS
    ) === link
  )
}

/**
 * One distinct confirmed tab receipt per page item, by position, or
 * undefined when any item lacks its own. Receipts in `consumed` are spoken
 * for by another outcome and open nothing here. Read per step, not per row:
 * a step is appended at each status, and only its planned row names the
 * requirement it was for, so the verified row alone never matched.
 */
export const agentPageItemTabs = (
  requirement: AgentTaskRequirement,
  steps: readonly AgentStepReadout[] | undefined,
  consumed: ReadonlySet<string> = new Set()
): AgentStepReadout[] | undefined => {
  const items = requirement.items ?? []
  if (requirement.itemsFrom !== "page" || items.length === 0 || !steps)
    return undefined
  const taken = new Set<string>()
  const tabs: AgentStepReadout[] = []
  const latest = latestAgentSteps(steps)
  for (const [index] of items.entries()) {
    const opened = latest.find(
      (receipt) =>
        !consumed.has(receipt.stepId) &&
        !taken.has(receipt.stepId) &&
        agentReceiptOpensPageItem(receipt, requirement, index)
    )
    if (!opened) return undefined
    taken.add(opened.stepId)
    tabs.push(opened)
  }
  return tabs
}
