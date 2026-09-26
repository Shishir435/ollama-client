import type {
  AgentCancellationSignal,
  AgentVerificationInput,
  AgentVerificationResult,
  ResolvedAgentBatchField
} from "@ollama-client/agent-runtime"
import {
  agentObservationStates,
  MAX_AGENT_SUBMITTED_VALUE_CHARS,
  MAX_AGENT_SUBMITTED_VALUES
} from "@ollama-client/agent-runtime"
import type { AgentObservation } from "@ollama-client/contracts"

import type { TabAccess } from "@/lib/browser-tab-access"
import { normalizeAgentEditorText } from "./editor-text"
import type {
  DialogAgentAction,
  DomMutationAgentAction,
  NavigationAgentAction,
  ReadOnlyAgentAction
} from "./resolved-effect"

export interface AgentEffectVerifierAdapter {
  observe(
    tabId: number,
    minimumGeneration: number,
    allowedOrigins: readonly string[],
    signal: AgentCancellationSignal
  ): Promise<AgentObservation>
  waitForNavigation?(
    tabId: number,
    sourceUrl: string,
    destinationUrl: string,
    signal: AgentCancellationSignal,
    sourceDocumentId?: string
  ): Promise<void>
  getActiveTabId(): Promise<number | undefined>
  getTab(tabId: number): Promise<{ url?: string } | undefined>
  classifyAccess(url?: string): Promise<TabAccess>
  /**
   * Pauses between two looks at the page. Absent means the host cannot, and
   * a bounded wait collapses to a single observation.
   */
  wait?(ms: number, signal: AgentCancellationSignal): Promise<void>
  now(): number
}

const result = (
  outcome: AgentVerificationResult["outcome"],
  kind: string,
  summary: string,
  now: number
): AgentVerificationResult => ({
  outcome,
  evidence: { kind, summary, observedAt: now }
})

const observeAfter = (
  input: AgentVerificationInput,
  adapter: AgentEffectVerifierAdapter,
  signal: AgentCancellationSignal,
  tabId = input.effect.snapshotIdentity.tabId
): Promise<AgentObservation> =>
  adapter.observe(
    tabId,
    input.effect.snapshotIdentity.generation + 1,
    input.allowedOrigins,
    signal
  )

const sameUrl = (first: string | undefined, second: string): boolean => {
  if (!first) return false
  try {
    return new URL(first).href === new URL(second).href
  } catch {
    return false
  }
}

/**
 * The observation is of the page the tab holds: same origin and path, and no
 * parameter both carry with different values. Dropping a parameter is the
 * site's to do between the two reads; refusing that is how a working search
 * whose tracking fields the site removed was left for review.
 */
const samePage = (first: string, second: string): boolean => {
  try {
    const a = new URL(first)
    const b = new URL(second)
    if (a.origin !== b.origin || a.pathname !== b.pathname) return false
    /**
     * A parameter one address dropped is the site's cleanup; one both carry
     * with different values is a different page. `?q=approved` observed as
     * `?q=other` is not the page the form was sent to.
     */
    for (const name of new Set(a.searchParams.keys())) {
      if (!b.searchParams.has(name)) continue
      const left = a.searchParams.getAll(name).sort()
      const right = b.searchParams.getAll(name).sort()
      if (
        left.length !== right.length ||
        left.some((value, index) => value !== right[index])
      )
        return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * Whether the tab landed on the address asked for, allowing what a site adds
 * on arrival. Searching DuckDuckGo for `?q=test` commits `?q=test&ia=web`, and
 * reading that as "a different destination" paused a search that had worked.
 * Same origin and path, every requested parameter present with exactly its
 * values, and a requested fragment kept; parameters the request did not
 * name, and a fragment it did not ask for, are the site's. A different
 * path, host or value is still a different destination.
 */
const landedAt = (committed: string, requested: string): boolean => {
  if (sameUrl(committed, requested)) return true
  try {
    const landed = new URL(committed)
    const asked = new URL(requested)
    if (landed.origin !== asked.origin || landed.pathname !== asked.pathname)
      return false
    /** A requested fragment is part of where the user asked to go. */
    if (asked.hash && landed.hash !== asked.hash) return false
    /**
     * Every requested parameter lands with exactly its requested values:
     * `?tag=a&tag=a` is not met by one `tag=a`, and `?q=approved` is not
     * met by `?q=approved&q=other`, whose page may search for `other`.
     */
    for (const name of new Set(asked.searchParams.keys())) {
      const want = asked.searchParams.getAll(name).sort()
      const got = landed.searchParams.getAll(name).sort()
      if (
        want.length !== got.length ||
        want.some((value, index) => value !== got[index])
      )
        return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * How many times a wait may look at the page before giving up, and the
 * narrowest and widest gap between those looks.
 *
 * A wait used to sleep its whole timeout and read the page once, which is the
 * worst of both: a save that landed in 300ms still cost thirty seconds, and
 * one that landed a moment after the single read was reported absent. Polling
 * returns as soon as the indicator appears and still cannot run long, because
 * every look is a full observation and the run pays for each one.
 */
const AGENT_WAIT_MAX_POLLS = 6
const AGENT_WAIT_MIN_INTERVAL_MS = 250
const AGENT_WAIT_MAX_INTERVAL_MS = 5_000

const waitInterval = (timeoutMs: number): number =>
  Math.min(
    AGENT_WAIT_MAX_INTERVAL_MS,
    Math.max(
      AGENT_WAIT_MIN_INTERVAL_MS,
      Math.round(timeoutMs / AGENT_WAIT_MAX_POLLS)
    )
  )

/**
 * How long an ordinary effect is given to show itself, and how many looks it
 * gets in that time.
 *
 * A page that answers a click over the network answers it a little after the
 * click. The verifier read once, immediately, so an effect that landed 1.2
 * seconds later was `ambiguous` — which pauses the run for the user as an
 * unresolved effect, three seconds after a step that had in fact worked.
 *
 * Two seconds, four looks, and it returns the moment the effect is there: the
 * cost is paid only by a step that would otherwise have been reported
 * unresolved, and a genuinely unknown outcome is still unknown at the end of
 * it. Short on purpose — this is a settle window, not a wait. A run that
 * needs to hold for an application state names it with `wait`, which has its
 * own timeout and its own budget.
 */
const AGENT_SETTLE_MAX_POLLS = 4
const AGENT_SETTLE_WINDOW_MS = 2_000
const AGENT_SETTLE_INTERVAL_MS = 500

/**
 * One bounded looking loop, shared by `wait` and by ordinary verification.
 *
 * Both ask the same question — is it there yet — and differ only in what
 * counts as settled and how long they may ask. A second mechanism beside this
 * one would be a second place for the spacing rule to be got wrong.
 *
 * The look before the last waits out whatever is left, so the final
 * observation lands at the deadline rather than an interval short of it: with
 * six looks there are five gaps, and spacing every gap evenly ended a
 * thirty-second wait at twenty-five seconds.
 */
const pollUntilSettled = async (
  adapter: AgentEffectVerifierAdapter,
  signal: AgentCancellationSignal,
  plan: { maxPolls: number; deadline: number; interval: number },
  look: (poll: number) => Promise<AgentVerificationResult>,
  settled: (outcome: AgentVerificationResult) => boolean
): Promise<AgentVerificationResult> => {
  for (let poll = 1; ; poll += 1) {
    const outcome = await look(poll)
    if (settled(outcome)) return outcome
    const remaining = plan.deadline - adapter.now()
    if (poll >= plan.maxPolls || remaining <= 0 || !adapter.wait) return outcome
    const lastGap = poll === plan.maxPolls - 1
    await adapter.wait(
      lastGap ? remaining : Math.min(plan.interval, remaining),
      signal
    )
  }
}

/**
 * Gives a verifier a short settle window before its answer is believed.
 *
 * Only an `ambiguous` answer is looked at again: `confirmed` and `negative`
 * are both conclusions drawn from evidence the page already gave, and
 * re-reading them would cost every honest step two seconds to learn nothing.
 * Ambiguity is the one answer that means "not yet", and it is the one that
 * pauses the run.
 *
 * Wrapped inside `withDelivery`, never outside it: a delivery problem, a file
 * chooser and a held dialog are settled facts about what happened to the
 * input, and looking at the page four more times cannot change any of them.
 */
const settling =
  (verifier: Verifier): Verifier =>
  (input, adapter, signal) =>
    pollUntilSettled(
      adapter,
      signal,
      {
        maxPolls: AGENT_SETTLE_MAX_POLLS,
        deadline: adapter.now() + AGENT_SETTLE_WINDOW_MS,
        interval: AGENT_SETTLE_INTERVAL_MS
      },
      () => verifier(input, adapter, signal),
      (outcome) => outcome.outcome !== "ambiguous"
    )

const resolvedTargetBecameVisible = (
  input: AgentVerificationInput,
  after: AgentObservation
): boolean => {
  if (!input.effect.target.ref) return false
  const before = input.before.elements.find(
    (element) => element.ref === input.effect.target.ref
  )
  if (!before || before.visible) return false
  const candidates = after.elements.filter(
    (element) =>
      element.visible &&
      element.frameId === (input.effect.target.frameId ?? 0) &&
      element.tag === input.effect.target.tag &&
      element.role === input.effect.target.role &&
      element.name === input.effect.target.accessibleName &&
      element.type === input.effect.target.inputType
  )
  return candidates.length === 1
}

type Verifier = (
  input: AgentVerificationInput,
  adapter: AgentEffectVerifierAdapter,
  signal: AgentCancellationSignal
) => Promise<AgentVerificationResult>

const verifyHistory: Verifier = async (input, adapter, signal) => {
  const destination = input.effect.destination
  if (!destination) {
    return result(
      "ambiguous",
      "navigation",
      "Destination unavailable",
      adapter.now()
    )
  }
  await adapter.waitForNavigation?.(
    input.effect.snapshotIdentity.tabId,
    input.effect.sourceUrl,
    destination.url,
    signal
  )
  const tab = await adapter.getTab(input.effect.snapshotIdentity.tabId)
  if (!tab?.url) {
    return result("ambiguous", "navigation", "Tab unavailable", adapter.now())
  }
  if (sameUrl(tab.url, destination.url)) {
    return (await adapter.classifyAccess(tab.url)) === "ok"
      ? result(
          "confirmed",
          "navigation",
          "Expected history destination committed",
          adapter.now()
        )
      : result(
          "ambiguous",
          "navigation",
          "Destination is no longer readable",
          adapter.now()
        )
  }
  return sameUrl(tab.url, input.effect.sourceUrl)
    ? result(
        "ambiguous",
        "navigation",
        "History destination did not settle before verification",
        adapter.now()
      )
    : result(
        "ambiguous",
        "navigation",
        "A different destination committed",
        adapter.now()
      )
}

/**
 * A pure read — a plain observation or a progressive inspection — is confirmed
 * when the page it named is still the page in hand. Inspection changes nothing
 * on the page, only what the next observation shows, so it verifies exactly as
 * a read does.
 */
const verifyPureRead: Verifier = async (input, adapter, signal) => {
  const after = await observeAfter(input, adapter, signal)
  return after.documentId === input.before.documentId &&
    sameUrl(after.url, input.before.url)
    ? result(
        "confirmed",
        "observation",
        "Fresh page observation received",
        adapter.now()
      )
    : result(
        "ambiguous",
        "observation",
        "Page changed while it was read",
        adapter.now()
      )
}

export const READ_ONLY_AGENT_VERIFIERS = {
  read: verifyPureRead,
  inspect: verifyPureRead,
  find: verifyPureRead,
  extract: verifyPureRead,
  extract_text: verifyPureRead,
  zoom: verifyPureRead,
  /**
   * Waiting is bounded looking, not sleeping.
   *
   * The condition is an application state the run is holding for — a saved
   * indicator, a row that appears, a spinner that goes — so the page is read
   * until it says so or the named timeout is spent, whichever comes first.
   * The whole named window is covered: the timeout is what the model was
   * promised, and reporting a condition absent before it has elapsed sends
   * the run off to re-plan work that was about to succeed. A host with no way
   * to pause between looks reads once, which is what this did before.
   */
  async wait(input, adapter, signal) {
    if (input.effect.command.type !== "wait")
      throw new Error("Invalid wait effect")
    const { condition, timeoutMs } = input.effect.command
    return pollUntilSettled(
      adapter,
      signal,
      {
        maxPolls: AGENT_WAIT_MAX_POLLS,
        deadline: input.receipt.executedAt + timeoutMs,
        interval: waitInterval(timeoutMs)
      },
      async (poll) => {
        const after = await observeAfter(input, adapter, signal)
        return agentObservationStates(condition, after)
          ? result(
              "confirmed",
              "condition",
              poll === 1
                ? "Named wait condition is present"
                : "Named wait condition appeared while waiting",
              adapter.now()
            )
          : result(
              "negative",
              "condition",
              "Named wait condition is absent after timeout",
              adapter.now()
            )
      },
      (outcome) => outcome.outcome === "confirmed"
    )
  },
  async scroll(input, adapter, signal) {
    if (input.effect.command.type !== "scroll")
      throw new Error("Invalid scroll effect")
    const after = await observeAfter(input, adapter, signal)
    const pane = input.effect.command.container === true
    const before = pane
      ? input.before.elements.find(
          (element) => element.ref === input.effect.target.ref
        )?.scroll
      : input.before.scroll
    const candidates = after.elements.filter(
      (element) =>
        element.frameId === input.effect.target.frameId &&
        element.verificationId === input.effect.target.verificationId
    )
    const afterScroll = pane
      ? input.effect.target.verificationId && candidates.length === 1
        ? candidates[0].scroll
        : undefined
      : after.scroll
    if (!before || !afterScroll)
      return result(
        "ambiguous",
        "scroll",
        "Scroll container could not be identified after scrolling",
        adapter.now()
      )
    const delta = {
      x: afterScroll.x - before.x,
      y: afterScroll.y - before.y
    }
    const moved =
      (input.effect.command.direction === "down" && delta.y > 0) ||
      (input.effect.command.direction === "up" && delta.y < 0) ||
      (input.effect.command.direction === "right" && delta.x > 0) ||
      (input.effect.command.direction === "left" && delta.x < 0)
    if (moved) {
      return result(
        "confirmed",
        "scroll",
        "Scroll position changed as requested",
        adapter.now()
      )
    }
    if (resolvedTargetBecameVisible(input, after)) {
      return result(
        "confirmed",
        "scroll",
        "Resolved scroll target became visible",
        adapter.now()
      )
    }
    /**
     * A native wheel scrolls whatever container sits under the pointer, and
     * an application whose document never scrolls still shows new content.
     * The window position is silent about that; the visible text is not.
     */
    if (
      input.receipt.backend === "cdp" &&
      after.visibleText !== input.before.visibleText
    ) {
      return result(
        "confirmed",
        "scroll",
        "Visible content changed as requested",
        adapter.now()
      )
    }
    const atBoundary =
      (input.effect.command.direction === "up" && before.y <= 0) ||
      (input.effect.command.direction === "left" && before.x <= 0) ||
      (input.effect.command.direction === "down" &&
        before.y + before.viewportHeight >= before.documentHeight) ||
      (input.effect.command.direction === "right" &&
        before.x + before.viewportWidth >= before.documentWidth)
    return atBoundary
      ? result(
          "negative",
          "scroll",
          "Page was already at the requested boundary",
          adapter.now()
        )
      : result(
          "ambiguous",
          "scroll",
          "Scroll movement could not be established",
          adapter.now()
        )
  },
  async switch_tab(input, adapter) {
    if (
      input.effect.command.type !== "switch_tab" ||
      !input.effect.destination
    ) {
      throw new Error("Invalid switch-tab effect")
    }
    const active = await adapter.getActiveTabId()
    if (active !== input.effect.command.tabId) {
      return result(
        "negative",
        "tab",
        "Requested tab is not active",
        adapter.now()
      )
    }
    const tab = await adapter.getTab(active)
    return tab?.url &&
      sameUrl(
        tab.url,
        input.receipt.submissionUrl ?? input.effect.destination.url
      ) &&
      (await adapter.classifyAccess(tab.url)) === "ok"
      ? result(
          "confirmed",
          "tab",
          "Requested readable tab is active",
          adapter.now()
        )
      : result(
          "ambiguous",
          "tab",
          "Active tab destination changed",
          adapter.now()
        )
  },
  back: verifyHistory,
  forward: verifyHistory
} satisfies Record<ReadOnlyAgentAction, Verifier>

export const verifyReadOnlyAgentEffect = async (input: {
  verification: AgentVerificationInput
  adapter: AgentEffectVerifierAdapter
  signal: AgentCancellationSignal
}): Promise<AgentVerificationResult> => {
  const verifier = READ_ONLY_AGENT_VERIFIERS[
    input.verification.effect.command.type as ReadOnlyAgentAction
  ] as Verifier | undefined
  if (!verifier) throw new Error("Agent action has no read-only verifier")
  return verifier(input.verification, input.adapter, input.signal)
}

/**
 * A destination is confirmed only when the tab is holding the exact URL the
 * user authorized and the run may still read it. A commit elsewhere — a
 * redirect, an interstitial, a consent wall — is ambiguous rather than
 * negative: the browser did move, so the step cannot be retried blindly.
 */
const verifyCommittedDestination = async (
  input: AgentVerificationInput,
  adapter: AgentEffectVerifierAdapter,
  tabId: number,
  kind: string,
  signal: AgentCancellationSignal
): Promise<AgentVerificationResult> => {
  const destination = input.effect.destination
  if (!destination) {
    return result("ambiguous", kind, "Destination unavailable", adapter.now())
  }
  try {
    await adapter.waitForNavigation?.(
      tabId,
      input.effect.sourceUrl,
      destination.url,
      signal
    )
  } catch (error) {
    /**
     * A navigation the page asked about has not happened. `beforeunload` is
     * held by the debugger, so the wait times out with the old page still in
     * the tab — which is a negative, not an unresolved effect: nothing
     * committed, and the run can re-observe, see the dialog and decide
     * whether to leave. Anything else that stopped the wait stays what it was.
     */
    if (signal.aborted) throw error
    const held = await observeAfter(input, adapter, signal, tabId).catch(
      () => undefined
    )
    if (!held?.dialogs.length) throw error
    return result(
      "negative",
      kind,
      "A dialog is holding the navigation",
      adapter.now()
    )
  }
  const tab = await adapter.getTab(tabId)
  if (!tab?.url) {
    return result("negative", kind, "Destination tab is gone", adapter.now())
  }
  if (!landedAt(tab.url, destination.url)) {
    return sameUrl(tab.url, input.effect.sourceUrl)
      ? result(
          "ambiguous",
          kind,
          "Navigation did not settle before verification",
          adapter.now()
        )
      : result(
          "ambiguous",
          kind,
          "A different destination committed",
          adapter.now()
        )
  }
  return (await adapter.classifyAccess(tab.url)) === "ok"
    ? result(
        "confirmed",
        kind,
        "Authorized destination is committed",
        adapter.now()
      )
    : result(
        "ambiguous",
        kind,
        "Destination is no longer readable",
        adapter.now()
      )
}

export const NAVIGATION_AGENT_VERIFIERS = {
  async navigate(input, adapter, signal) {
    const committed = await verifyCommittedDestination(
      input,
      adapter,
      input.effect.snapshotIdentity.tabId,
      "navigation",
      signal
    )
    if (committed.outcome !== "confirmed") return committed
    /**
     * A same-document route change commits the URL without replacing the
     * document, so the document identity is recorded rather than required: an
     * observation that still reports the pre-navigation URL means the tab
     * answered but the page did not move.
     */
    const after = await observeAfter(input, adapter, signal)
    if (!landedAt(after.url, input.effect.destination?.url ?? "")) {
      return result(
        "ambiguous",
        "navigation",
        "Observed page does not match the committed destination",
        adapter.now()
      )
    }
    return result(
      "confirmed",
      "navigation",
      after.documentId === input.before.documentId
        ? "Destination committed within the same document"
        : "Destination committed in a new document",
      adapter.now()
    )
  },
  async open_tab(input, adapter, signal) {
    if (input.effect.command.type !== "open_tab" || !input.effect.destination) {
      throw new Error("Invalid open-tab effect")
    }
    /**
     * The opened tab is only knowable from the receipt; without it there is
     * nothing to check and nothing the run may adopt.
     */
    const opened = input.receipt.controlledTabId
    if (opened === undefined) {
      return result(
        "ambiguous",
        "tab",
        "Opened tab was not reported",
        adapter.now()
      )
    }
    return verifyCommittedDestination(input, adapter, opened, "tab", signal)
  }
} satisfies Record<NavigationAgentAction, Verifier>

export const verifyNavigationAgentEffect = async (input: {
  verification: AgentVerificationInput
  adapter: AgentEffectVerifierAdapter
  signal: AgentCancellationSignal
}): Promise<AgentVerificationResult> => {
  const verifier = NAVIGATION_AGENT_VERIFIERS[
    input.verification.effect.command.type as NavigationAgentAction
  ] as Verifier | undefined
  if (!verifier) throw new Error("Agent action has no navigation verifier")
  return verifier(input.verification, input.adapter, input.signal)
}

const sameElementSemantics = (
  input: AgentVerificationInput,
  element: AgentObservation["elements"][number]
): boolean =>
  element.frameId === (input.effect.target.frameId ?? 0) &&
  (input.effect.target.verificationId === undefined ||
    element.verificationId === input.effect.target.verificationId) &&
  element.tag === input.effect.target.tag &&
  element.role === input.effect.target.role &&
  element.name === input.effect.target.accessibleName &&
  element.type === input.effect.target.inputType

const mutationTargetAfter = (
  input: AgentVerificationInput,
  after: AgentObservation
):
  | { type: "one"; element: AgentObservation["elements"][number] }
  | { type: "missing" | "ambiguous" } => {
  const matches = after.elements.filter((element) =>
    sameElementSemantics(input, element)
  )
  if (matches.length === 0) return { type: "missing" }
  if (matches.length > 1) return { type: "ambiguous" }
  return { type: "one", element: matches[0] }
}

/**
 * What counts as the page having changed. Focus is deliberately left out: a
 * native click moves focus onto the control it lands on, and a silent button
 * that merely took focus is not a button that did something. Focus traversal
 * has its own explicit check in the key verifier.
 */
const pageEvidence = (observation: AgentObservation): string =>
  JSON.stringify({
    url: observation.url,
    documentId: observation.documentId,
    title: observation.title,
    visibleText: observation.visibleText,
    elements: observation.elements.map((element) => ({
      tag: element.tag,
      role: element.role,
      name: element.name,
      type: element.type,
      value: element.value,
      checked: element.checked,
      href: element.href,
      visible: element.visible,
      enabled: element.enabled
    }))
  })

/**
 * Native input the page did not receive as planned settles the step before any
 * page evidence is read. Interference means a hand other than the agent's was
 * on the page during the action, so whatever changed cannot be attributed; a
 * partial or misdirected plan means the resolved control was not the one that
 * received the input. Either is an unresolved effect the user has to look at,
 * never a confirmed one and never a clean negative to retry.
 */
const deliveryProblem = (
  input: AgentVerificationInput,
  kind: string,
  now: number
): AgentVerificationResult | undefined => {
  switch (input.receipt.inputDelivery) {
    case "interference":
      return result(
        "ambiguous",
        kind,
        "User input was observed while the action ran",
        now
      )
    case "misdirected":
      return result(
        "ambiguous",
        kind,
        "Native input reached an element other than the target",
        now
      )
    case "partial":
      return result(
        "ambiguous",
        kind,
        "Native input was cut short before the plan completed",
        now
      )
    default:
      return undefined
  }
}

/**
 * A file chooser the page opened is a step the run cannot finish: the
 * debugger held the dialog back, nothing was chosen, and only the user can
 * choose. The step is left unresolved for them rather than judged from a page
 * that is waiting for a file.
 */
const fileChooserProblem = (
  input: AgentVerificationInput,
  now: number
): AgentVerificationResult | undefined =>
  input.receipt.fileChooser
    ? result(
        "ambiguous",
        "file_chooser",
        "The page asked for a file; choose it yourself, then continue",
        now
      )
    : undefined

const withDelivery =
  (kind: string, verifier: Verifier): Verifier =>
  async (input, adapter, signal) => {
    if (input.receipt.dialogOpened) {
      const after = await observeAfter(input, adapter, signal)
      const held = after.dialogs.some(
        (dialog) => dialog.id === input.receipt.dialogOpened
      )
      const activation =
        input.receipt.inputDelivery !== "undelivered" &&
        ["click", "click_point", "press_key"].includes(
          input.effect.command.type
        )
      return result(
        held && activation ? "confirmed" : "ambiguous",
        "native_dialog",
        held && activation
          ? "Activation reached a held native dialog. Answer the dialog before judging the task outcome."
          : "Input was interrupted by a native dialog; its effect is unresolved",
        adapter.now()
      )
    }
    return (
      fileChooserProblem(input, adapter.now()) ??
      deliveryProblem(input, kind, adapter.now()) ??
      verifier(input, adapter, signal)
    )
  }

/**
 * Field values compare exactly, except an editor's: its value is its markup
 * flattened, and the editor may render the same text as `<p>` on one read and
 * `<div><br></div>` on the next. Both sides go through the one normalization
 * the page used, so a paragraph break is a paragraph break however it is
 * spelled.
 */
const sameFieldValue = (
  target: AgentVerificationInput["effect"]["target"],
  actual: string,
  expected: string | undefined
): boolean => {
  if (expected === undefined) return false
  if (target.inputType?.toLowerCase() !== "contenteditable") {
    return actual === expected
  }
  return normalizeAgentEditorText(actual) === normalizeAgentEditorText(expected)
}

const verifyValueMutation: Verifier = async (input, adapter, signal) => {
  const after = await observeAfter(input, adapter, signal)
  const target = mutationTargetAfter(input, after)
  if (target.type !== "one") {
    return result(
      "ambiguous",
      "field",
      target.type === "missing"
        ? "Mutated field is no longer identifiable"
        : "Mutated field matches multiple controls",
      adapter.now()
    )
  }
  if (
    target.element.sensitive ||
    target.element.valueTruncated ||
    target.element.value === undefined
  ) {
    return result(
      "ambiguous",
      "field",
      "Mutated field value is unavailable",
      adapter.now()
    )
  }
  if (
    sameFieldValue(
      input.effect.target,
      target.element.value,
      input.effect.target.expectedValue
    )
  ) {
    return result(
      "confirmed",
      "field",
      "Field contains the resolved value",
      adapter.now()
    )
  }
  return target.element.value === input.effect.target.observedValue
    ? result("negative", "field", "Field value did not change", adapter.now())
    : result(
        "ambiguous",
        "field",
        "Field contains a value other than the resolved value",
        adapter.now()
      )
}

const verifyCheckedMutation: Verifier = async (input, adapter, signal) => {
  const after = await observeAfter(input, adapter, signal)
  const target = mutationTargetAfter(input, after)
  if (target.type !== "one" || target.element.checked === undefined) {
    return result(
      "ambiguous",
      "checked",
      "Checked control is no longer uniquely identifiable",
      adapter.now()
    )
  }
  if (target.element.checked === input.effect.target.expectedChecked) {
    return result(
      "confirmed",
      "checked",
      "Control has the resolved checked state",
      adapter.now()
    )
  }
  return target.element.checked === input.effect.target.observedChecked
    ? result(
        "negative",
        "checked",
        "Checked state did not change",
        adapter.now()
      )
    : result(
        "ambiguous",
        "checked",
        "Control has an unexpected checked state",
        adapter.now()
      )
}

/**
 * The values a GET submission sent, as proof of what this form carried
 * rather than anything typed elsewhere on the page, each with the label of
 * the control that held it.
 *
 * Read from `formQuery`, the query of visible fields the approval's address
 * was built from and the executor refused to send if it had changed — never
 * from the landed address, which carries hidden fields such as tokens, and
 * these values are kept on a durable receipt. Absent when the form has a
 * hidden or sensitive control, since `formQuery` is then never built. A
 * value too long to keep whole is dropped rather than cut, so no fragment
 * of it reads as a word it never was.
 *
 * The label is what lets `q=Alice&category=Bob` prove "Search for Alice"
 * and not "Search for Bob": parameter names are the site's, while the
 * control's name is the word a requirement uses. It is taken from the
 * control of this same form holding exactly that value; a value no single
 * control holds keeps no label.
 */
const submittedValues = (
  input: AgentVerificationInput
): { name?: string; value: string }[] => {
  const target = input.effect.target
  if (target.formQuery === undefined || target.formHasSensitiveControl)
    return []
  const controls = input.before.elements.filter(
    (element) =>
      target.formFingerprint !== undefined &&
      element.formFingerprint === target.formFingerprint
  )
  return [...new URLSearchParams(target.formQuery).values()]
    .filter(
      (value) =>
        value.trim().length > 0 &&
        value.length <= MAX_AGENT_SUBMITTED_VALUE_CHARS
    )
    .slice(0, MAX_AGENT_SUBMITTED_VALUES)
    .map((value) => {
      const holders = controls.filter((element) => element.value === value)
      const name = holders.length === 1 ? holders[0].name?.trim() : undefined
      return name ? { name: name.slice(0, 120), value } : { value }
    })
}

const verifySubmission: Verifier = async (input, adapter, signal) => {
  const tabId = input.effect.snapshotIdentity.tabId
  const expectedUrl =
    input.receipt.submissionUrl ?? input.effect.destination?.url
  if (expectedUrl)
    await adapter.waitForNavigation?.(
      tabId,
      input.effect.sourceUrl,
      expectedUrl,
      signal,
      input.before.documentId
    )
  const tab = await adapter.getTab(tabId)
  if (!tab?.url) {
    return result(
      "ambiguous",
      "submission",
      "Submission tab is unavailable",
      adapter.now()
    )
  }
  if (!sameUrl(tab.url, input.effect.sourceUrl)) {
    const requested =
      input.receipt.submissionUrl ?? input.effect.destination?.url
    if (
      input.effect.destination &&
      requested &&
      landedAt(tab.url, requested) &&
      (await adapter.classifyAccess(tab.url)) === "ok"
    ) {
      const values = submittedValues(input)
      return {
        outcome: "confirmed",
        evidence: {
          kind: "submission",
          summary: "Form committed its resolved destination",
          observedAt: adapter.now(),
          ...(values.length ? { values } : {})
        }
      }
    }
    // POST/redirect/GET normally lands on a result page, often back on the
    // source page with a new comment anchor. The guarded submission receipt
    // proves the approved form was dispatched; a fresh readable document on
    // that destination's origin verifies navigation, not business success.
    // The completion check still has to establish the user's requested result.
    if (
      input.receipt.submissionUrl &&
      input.effect.destination &&
      input.effect.target.frameId === input.before.frameId &&
      new URL(tab.url).origin === input.effect.destination.origin &&
      (await adapter.classifyAccess(tab.url)) === "ok"
    ) {
      const after = await observeAfter(input, adapter, signal)
      if (
        samePage(after.url, tab.url) &&
        after.origin === input.effect.destination.origin &&
        after.documentId !== input.before.documentId
      ) {
        return result(
          "confirmed",
          "submission",
          "Form submission reached a new document on its approved origin",
          adapter.now()
        )
      }
    }
    return result(
      "ambiguous",
      "submission",
      "Form committed an unexpected destination",
      adapter.now()
    )
  }
  const after = await observeAfter(input, adapter, signal)
  if (
    after.documentId !== input.before.documentId ||
    pageEvidence(after) !== pageEvidence(input.before)
  ) {
    return result(
      "confirmed",
      "submission",
      "Form submission produced an observable page change",
      adapter.now()
    )
  }
  return result(
    "ambiguous",
    "submission",
    "Form submission produced no conclusive page evidence",
    adapter.now()
  )
}

/**
 * Widgets whose job is to receive input once they hold focus. A click that
 * lands focus on one of these has done what a click on them does — the typing
 * or arrow keys come next. A button or a link taking focus proves nothing of
 * the kind, so they are not in the set.
 */
const FOCUS_RECEIVING_ROLES = new Set([
  "combobox",
  "grid",
  "gridcell",
  "listbox",
  "option",
  "searchbox",
  "slider",
  "spinbutton",
  "tab",
  "textbox",
  "tree",
  "treeitem"
])
const FOCUS_RECEIVING_TAGS = new Set(["input", "select", "textarea"])

const receivesInputOnFocus = (
  target: AgentVerificationInput["effect"]["target"]
): boolean =>
  FOCUS_RECEIVING_ROLES.has(target.role?.toLowerCase() ?? "") ||
  (FOCUS_RECEIVING_TAGS.has(target.tag ?? "") &&
    !["button", "submit", "reset", "image"].includes(
      target.inputType?.toLowerCase() ?? ""
    ))

const verifyActivation: Verifier = async (input, adapter, signal) => {
  if (input.effect.semanticEffects.includes("submission")) {
    return verifySubmission(input, adapter, signal)
  }
  if (input.effect.destination) {
    return verifyCommittedDestination(
      input,
      adapter,
      input.effect.snapshotIdentity.tabId,
      "activation",
      signal
    )
  }
  const after = await observeAfter(input, adapter, signal)
  if (pageEvidence(after) !== pageEvidence(input.before)) {
    return result(
      "confirmed",
      "activation",
      "Control activation produced an observable page change",
      adapter.now()
    )
  }
  /**
   * A link that opens its page in a new tab leaves this one exactly as it
   * was, so the click read as having done nothing and paused the run as an
   * unresolved effect while the page it asked for sat in the next tab.
   */
  if (input.receipt.openedTabIds?.length) {
    return result(
      "confirmed",
      "activation",
      "Control opened a new tab",
      adapter.now()
    )
  }
  const target = mutationTargetAfter(input, after)
  if (
    target.type === "one" &&
    target.element.focused === true &&
    !input.effect.target.observedFocused &&
    receivesInputOnFocus(input.effect.target)
  ) {
    return result(
      "confirmed",
      "activation",
      "Control took focus and is ready for input",
      adapter.now()
    )
  }
  return result(
    "ambiguous",
    "activation",
    "Control activation produced no conclusive page evidence",
    adapter.now()
  )
}

/**
 * A hover has no state of its own to read back. A page that reacted — a menu
 * opened, a tooltip appeared — is evidence enough; a page that did not is
 * still confirmed when the document reported the pointer arriving on the
 * control, because that is all a hover promises. Without either the pointer
 * may have gone anywhere, and the step stays unresolved.
 */
const verifyHover: Verifier = async (input, adapter, signal) => {
  const after = await observeAfter(input, adapter, signal)
  if (pageEvidence(after) !== pageEvidence(input.before)) {
    return result(
      "confirmed",
      "hover",
      "Pointer hover produced an observable page change",
      adapter.now()
    )
  }
  if (input.receipt.inputDelivery === "delivered") {
    return result(
      "confirmed",
      "hover",
      "Pointer reached the control",
      adapter.now()
    )
  }
  return result(
    "ambiguous",
    "hover",
    "Pointer hover produced no conclusive page evidence",
    adapter.now()
  )
}

const isFocusTraversal = (key: string): boolean =>
  key === "Tab" || key === "Shift+Tab"

const verifyKey: Verifier = async (input, adapter, signal) => {
  if (input.effect.semanticEffects.includes("submission")) {
    return verifySubmission(input, adapter, signal)
  }
  const after = await observeAfter(input, adapter, signal)
  const target = mutationTargetAfter(input, after)
  if (
    input.effect.command.type === "press_key" &&
    isFocusTraversal(input.effect.command.key) &&
    target.type === "one" &&
    !target.element.focused &&
    after.elements.some((element) => element.focused)
  ) {
    return result(
      "confirmed",
      "keyboard",
      "Keyboard focus moved to another control",
      adapter.now()
    )
  }
  if (pageEvidence(after) !== pageEvidence(input.before)) {
    return result(
      "confirmed",
      "keyboard",
      "Key press produced an observable page change",
      adapter.now()
    )
  }
  return result(
    "negative",
    "keyboard",
    "Key press produced no observable page change",
    adapter.now()
  )
}

type ObservedElement = AgentObservation["elements"][number]

const sameSemantics = (
  first: Pick<ObservedElement, "tag" | "role" | "name" | "type">,
  second: Pick<ObservedElement, "tag" | "role" | "name" | "type">
): boolean =>
  first.tag === second.tag &&
  first.role === second.role &&
  first.name === second.name &&
  first.type === second.type

/**
 * The one element in an observation matching the drop target's facts, in the
 * drag's own frame. Ambiguity is reported as absence: a destination the
 * observation cannot single out cannot anchor an arrangement claim.
 */
const dropTargetIn = (
  input: AgentVerificationInput,
  observation: AgentObservation
): ObservedElement | undefined => {
  const drop = input.effect.target.drop
  if (!drop) return undefined
  const matches = observation.elements.filter(
    (element) =>
      element.frameId === drop.frameId &&
      (drop.verificationId === undefined ||
        element.verificationId === drop.verificationId) &&
      element.tag === drop.tag &&
      element.role === drop.role &&
      element.name === drop.accessibleName
  )
  return matches.length === 1 ? matches[0] : undefined
}

/** The neighbours an element has in document order, by what they are. */
const neighboursOf = (
  observation: AgentObservation,
  element: ObservedElement
): { before?: ObservedElement; after?: ObservedElement } => {
  const peers = observation.elements.filter(
    (candidate) => candidate.frameId === element.frameId
  )
  const index = peers.indexOf(element)
  return { before: peers[index - 1], after: peers[index + 1] }
}

const sameNeighbour = (
  first: ObservedElement | undefined,
  second: ObservedElement | undefined
): boolean =>
  first === undefined || second === undefined
    ? first === second
    : sameSemantics(first, second)

/**
 * A drag is verified by the arrangement it leaves, never by the page merely
 * having changed. The dragged element is found again by what it is; it has
 * moved when its order relative to the destination flipped, when it sits in
 * a different region, or when the controls beside it are no longer the ones
 * that were beside it. A source that is simply gone is never confirmed: a
 * rerender that hides it, a timer, or a misdirected drag looks identical to a
 * drop a trash target swallowed, and confirming a disappearance would credit
 * an effect that may never have reached the destination. An identical page is
 * a negative; a page that changed without the element visibly moving to its
 * destination is left uncertain, because a pointer drag that landed somewhere
 * else has changed something the run did not intend.
 */
const verifyDrag: Verifier = async (input, adapter, signal) => {
  const after = await observeAfter(input, adapter, signal)
  const changed = pageEvidence(after) !== pageEvidence(input.before)
  const source = mutationTargetAfter(input, after)
  if (source.type !== "one") {
    return result(
      "ambiguous",
      "arrangement",
      source.type === "missing"
        ? "Dragged element is gone; its move to the destination is unconfirmed"
        : "Dragged element is no longer identifiable",
      adapter.now()
    )
  }
  const sourceBefore = input.before.elements.find(
    (element) => element.ref === input.effect.target.ref
  )
  const destinationBefore = dropTargetIn(input, input.before)
  const destinationAfter = dropTargetIn(input, after)
  if (sourceBefore && destinationBefore && destinationAfter) {
    const wasBefore =
      input.before.elements.indexOf(sourceBefore) <
      input.before.elements.indexOf(destinationBefore)
    const isBefore =
      after.elements.indexOf(source.element) <
      after.elements.indexOf(destinationAfter)
    if (wasBefore !== isBefore) {
      return result(
        "confirmed",
        "arrangement",
        "Dragged element moved past its destination",
        adapter.now()
      )
    }
  }
  if (sourceBefore && sourceBefore.group !== source.element.group) {
    return result(
      "confirmed",
      "arrangement",
      "Dragged element moved into another region",
      adapter.now()
    )
  }
  if (sourceBefore) {
    const before = neighboursOf(input.before, sourceBefore)
    const now = neighboursOf(after, source.element)
    if (
      !sameNeighbour(before.before, now.before) ||
      !sameNeighbour(before.after, now.after)
    ) {
      return result(
        "confirmed",
        "arrangement",
        "Dragged element sits among different controls",
        adapter.now()
      )
    }
  }
  return changed
    ? result(
        "ambiguous",
        "arrangement",
        "Page changed but the dragged element did not visibly move",
        adapter.now()
      )
    : result(
        "negative",
        "arrangement",
        "Arrangement did not change",
        adapter.now()
      )
}

/**
 * Whether one field of a batch holds what it was set to.
 *
 * The same two comparisons the single-field verifiers make, against the same
 * resolved expectation, matched by the same element semantics. Sharing the
 * question is the point: a batch confirmed on rules of its own would be a
 * second definition of "the field holds the value", and the two would
 * disagree the first time either moved.
 */
const batchFieldHolds = (
  field: ResolvedAgentBatchField,
  after: AgentObservation
): boolean => {
  const matches = after.elements.filter(
    (element) =>
      element.frameId === (field.target.frameId ?? 0) &&
      (field.target.verificationId === undefined ||
        element.verificationId === field.target.verificationId) &&
      element.tag === field.target.tag &&
      element.role === field.target.role &&
      element.name === field.target.accessibleName &&
      element.type === field.target.inputType
  )
  if (matches.length !== 1) return false
  const element = matches[0]
  if (field.target.expectedChecked !== undefined) {
    return element.checked === field.target.expectedChecked
  }
  if (element.sensitive || element.valueTruncated) return false
  if (element.value === undefined) return false
  return sameFieldValue(field.target, element.value, field.target.expectedValue)
}

/**
 * A batch is confirmed when every field the page said it applied holds its
 * value, and nothing weaker.
 *
 * The receipt carries how many landed, so the verifier checks exactly those:
 * crediting a field the page never reached would be the batch version of the
 * failure this whole release is about — claiming a task finished because one
 * part of it did. A batch that stopped early is reported as `negative` with
 * its count, which leaves the run holding a true statement about a page it
 * half changed, and the model free to send the rest.
 */
const verifyFormFill: Verifier = async (input, adapter, signal) => {
  const fields = input.effect.batch?.fields ?? []
  const applied = input.receipt.fieldsApplied ?? 0
  if (applied === 0 || fields.length === 0) {
    return result("negative", "fields", "No field was applied", adapter.now())
  }
  const after = await observeAfter(input, adapter, signal)
  const checked = fields.slice(0, applied)
  const held = checked.filter((field) => batchFieldHolds(field, after)).length
  if (held < checked.length) {
    return result(
      "ambiguous",
      "fields",
      `${held} of ${checked.length} applied fields hold the resolved value`,
      adapter.now()
    )
  }
  return applied < fields.length
    ? result(
        "negative",
        "fields",
        `${applied} of ${fields.length} fields were applied; the rest were refused`,
        adapter.now()
      )
    : {
        outcome: "confirmed",
        evidence: {
          kind: "fields",
          summary: `All ${applied} fields hold the resolved value`,
          observedAt: adapter.now(),
          fields: fields.map((field) =>
            field.target.sensitive
              ? {}
              : { name: field.target.accessibleName?.slice(0, 120) }
          )
        }
      }
}

export const verifyFormFillAgentEffect = async (input: {
  verification: AgentVerificationInput
  adapter: AgentEffectVerifierAdapter
  signal: AgentCancellationSignal
}): Promise<AgentVerificationResult> =>
  settling(verifyFormFill)(input.verification, input.adapter, input.signal)

export const DOM_MUTATION_AGENT_VERIFIERS = {
  click: withDelivery("activation", settling(verifyActivation)),
  click_point: withDelivery("activation", settling(verifyActivation)),
  double_click: withDelivery("activation", settling(verifyActivation)),
  hover: withDelivery("hover", settling(verifyHover)),
  type: withDelivery("field", settling(verifyValueMutation)),
  clear_and_type: withDelivery("field", settling(verifyValueMutation)),
  replace_text: withDelivery("field", settling(verifyValueMutation)),
  drag: withDelivery("arrangement", settling(verifyDrag)),
  select: settling(verifyValueMutation),
  check: settling(verifyCheckedMutation),
  uncheck: settling(verifyCheckedMutation),
  press_key: withDelivery("keyboard", settling(verifyKey))
} satisfies Record<DomMutationAgentAction, Verifier>

/**
 * A dialog answer is confirmed by the dialog being gone.
 *
 * The page unblocks the moment it is answered, so the fresh observation is
 * the evidence: the prompt this step named is no longer held. A prompt still
 * open is a negative — nothing was answered — while a different prompt now
 * open is ambiguous: this one was answered and the page immediately asked
 * something else, which the next step reads rather than this one crediting.
 */
const verifyDialogAnswer: Verifier = async (input, adapter, signal) => {
  const answered = input.effect.dialog?.id
  const after = await observeAfter(input, adapter, signal)
  if (answered && after.dialogs.some((open) => open.id === answered)) {
    return result(
      "negative",
      "dialog",
      "The dialog is still holding the page",
      adapter.now()
    )
  }
  return after.dialogs.length > 0
    ? result(
        "ambiguous",
        "dialog",
        "The dialog was answered and the page opened another",
        adapter.now()
      )
    : result("confirmed", "dialog", "No dialog holds the page", adapter.now())
}

export const DIALOG_AGENT_VERIFIERS = {
  handle_dialog: verifyDialogAnswer
} satisfies Record<DialogAgentAction, Verifier>

export const verifyDialogAgentEffect = async (input: {
  verification: AgentVerificationInput
  adapter: AgentEffectVerifierAdapter
  signal: AgentCancellationSignal
}): Promise<AgentVerificationResult> => {
  const verifier = DIALOG_AGENT_VERIFIERS[
    input.verification.effect.command.type as DialogAgentAction
  ] as Verifier | undefined
  if (!verifier) throw new Error("Agent action has no dialog verifier")
  return verifier(input.verification, input.adapter, input.signal)
}

export const verifyDomMutationAgentEffect = async (input: {
  verification: AgentVerificationInput
  adapter: AgentEffectVerifierAdapter
  signal: AgentCancellationSignal
}): Promise<AgentVerificationResult> => {
  const verifier = DOM_MUTATION_AGENT_VERIFIERS[
    input.verification.effect.command.type as DomMutationAgentAction
  ] as Verifier | undefined
  if (!verifier) throw new Error("Agent action has no DOM mutation verifier")
  return verifier(input.verification, input.adapter, input.signal)
}
