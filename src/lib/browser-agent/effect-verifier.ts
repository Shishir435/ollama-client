import type {
  AgentCancellationSignal,
  AgentVerificationInput,
  AgentVerificationResult
} from "@ollama-client/agent-runtime"
import type { AgentObservation } from "@ollama-client/contracts"

import type { TabAccess } from "@/lib/browser-tab-access"
import type { ReadOnlyAgentAction } from "./resolved-effect"

export interface AgentEffectVerifierAdapter {
  observe(
    tabId: number,
    minimumGeneration: number,
    signal: AgentCancellationSignal
  ): Promise<AgentObservation>
  getActiveTabId(): Promise<number | undefined>
  getTab(tabId: number): Promise<{ url?: string } | undefined>
  classifyAccess(url?: string): Promise<TabAccess>
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
  adapter.observe(tabId, input.effect.snapshotIdentity.generation + 1, signal)

const sameUrl = (first: string | undefined, second: string): boolean => {
  if (!first) return false
  try {
    return new URL(first).href === new URL(second).href
  } catch {
    return false
  }
}

const conditionAppears = (
  condition: string,
  observation: AgentObservation
): boolean => {
  const needle = condition.replaceAll(/\s+/g, " ").trim().toLocaleLowerCase()
  if (!needle) return false
  const haystack = [
    observation.title,
    observation.visibleText,
    ...observation.elements.flatMap((element) =>
      [element.name, element.value].filter(
        (value): value is string => value !== undefined
      )
    )
  ]
    .join(" ")
    .replaceAll(/\s+/g, " ")
    .toLocaleLowerCase()
  return haystack.includes(needle)
}

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

const verifyHistory: Verifier = async (input, adapter) => {
  const destination = input.effect.destination
  if (!destination) {
    return result(
      "ambiguous",
      "navigation",
      "Destination unavailable",
      adapter.now()
    )
  }
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
        "negative",
        "navigation",
        "History position did not change",
        adapter.now()
      )
    : result(
        "ambiguous",
        "navigation",
        "A different destination committed",
        adapter.now()
      )
}

export const READ_ONLY_AGENT_VERIFIERS = {
  async read(input, adapter, signal) {
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
  },
  async wait(input, adapter, signal) {
    if (input.effect.command.type !== "wait")
      throw new Error("Invalid wait effect")
    const after = await observeAfter(input, adapter, signal)
    return conditionAppears(input.effect.command.condition, after)
      ? result(
          "confirmed",
          "condition",
          "Named wait condition is present",
          adapter.now()
        )
      : result(
          "negative",
          "condition",
          "Named wait condition is absent after timeout",
          adapter.now()
        )
  },
  async scroll(input, adapter, signal) {
    if (input.effect.command.type !== "scroll")
      throw new Error("Invalid scroll effect")
    const after = await observeAfter(input, adapter, signal)
    const before = input.before.scroll
    const delta = {
      x: after.scroll.x - before.x,
      y: after.scroll.y - before.y
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
      sameUrl(tab.url, input.effect.destination.url) &&
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
