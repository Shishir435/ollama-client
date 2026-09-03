import type {
  AgentCancellationSignal,
  AgentExecutionReceipt,
  AuthorizedAgentEffect
} from "@ollama-client/agent-runtime"
import type { AgentSnapshotIdentity } from "@ollama-client/contracts"

import type { TabAccess } from "@/lib/browser-tab-access"
import type { AgentElementReferenceStore } from "./element-references"
import type {
  NavigationAgentAction,
  ReadOnlyAgentAction
} from "./resolved-effect"

export const executeAgentScrollInDocument = (input: {
  command: Extract<AuthorizedAgentEffect["command"], { type: "scroll" }>
  identity: AgentSnapshotIdentity
  document: Document
  references: AgentElementReferenceStore
}): void => {
  const identity = { ...input.identity, frameId: 0 as const }
  if (!input.references.matches(identity)) {
    throw new Error("Agent scroll snapshot is stale")
  }
  if (input.command.ref) {
    const target = input.references.resolve(input.command.ref, identity)
    if (!target) throw new Error("Agent scroll target is stale")
    target.scrollIntoView({ block: "center", inline: "center" })
    return
  }
  const view = input.document.defaultView
  if (!view) throw new Error("Agent scroll window is unavailable")
  const amount =
    input.command.amount ??
    (input.command.direction === "up" || input.command.direction === "down"
      ? view.innerHeight * 0.8
      : view.innerWidth * 0.8)
  view.scrollBy({
    behavior: "instant",
    left:
      input.command.direction === "left"
        ? -amount
        : input.command.direction === "right"
          ? amount
          : 0,
    top:
      input.command.direction === "up"
        ? -amount
        : input.command.direction === "down"
          ? amount
          : 0
  })
}

export interface AgentCommandExecutorAdapter {
  getTab(tabId: number): Promise<{ id?: number; url?: string } | undefined>
  getMainFrame(
    tabId: number
  ): Promise<{ documentId?: string; url: string } | null>
  classifyAccess(url?: string): Promise<TabAccess>
  scroll(
    command: Extract<AuthorizedAgentEffect["command"], { type: "scroll" }>,
    identity: AgentSnapshotIdentity,
    signal: AgentCancellationSignal
  ): Promise<void>
  activateTab(tabId: number): Promise<void>
  goHistory(tabId: number, direction: "back" | "forward"): Promise<void>
  resolveHistoryDestination(
    tabId: number,
    direction: "back" | "forward"
  ): Promise<string | undefined>
  wait(ms: number, signal: AgentCancellationSignal): Promise<void>
  navigate(tabId: number, url: string): Promise<void>
  createTab(input: {
    url: string
    openerTabId: number
  }): Promise<{ id?: number; url?: string } | undefined>
  now(): number
}

const exactUrl = (value: string | undefined, expected: string): boolean => {
  if (!value) return false
  try {
    return new URL(value).href === new URL(expected).href
  } catch {
    return false
  }
}

const exactOrigin = (value: string | undefined, expected: string): boolean => {
  if (!value) return false
  try {
    return new URL(value).origin === expected
  } catch {
    return false
  }
}

const assertReadable = async (
  adapter: AgentCommandExecutorAdapter,
  url: string | undefined
): Promise<void> => {
  if ((await adapter.classifyAccess(url)) !== "ok") {
    throw new Error("Agent tab access changed before execution")
  }
}

const assertSource = async (
  effect: AuthorizedAgentEffect,
  adapter: AgentCommandExecutorAdapter,
  requireDocument: boolean
): Promise<void> => {
  const tab = await adapter.getTab(effect.snapshotIdentity.tabId)
  if (
    !tab ||
    !exactUrl(tab.url, effect.sourceUrl) ||
    !exactOrigin(tab.url, effect.sourceOrigin)
  ) {
    throw new Error("Agent source tab changed before execution")
  }
  await assertReadable(adapter, tab.url)
  if (!requireDocument) return
  const frame = await adapter.getMainFrame(effect.snapshotIdentity.tabId)
  if (
    !frame ||
    frame.documentId !== effect.snapshotIdentity.documentId ||
    !exactUrl(frame.url, effect.sourceUrl)
  ) {
    throw new Error("Agent source document changed before execution")
  }
}

type Executor = (
  effect: AuthorizedAgentEffect,
  adapter: AgentCommandExecutorAdapter,
  signal: AgentCancellationSignal
) => Promise<AgentExecutionReceipt>

const receipt = (
  adapter: AgentCommandExecutorAdapter,
  details: string,
  controlledTabId?: number
): AgentExecutionReceipt => ({
  executedAt: adapter.now(),
  details,
  ...(controlledTabId === undefined ? {} : { controlledTabId })
})

export const READ_ONLY_AGENT_EXECUTORS = {
  async read(effect, adapter) {
    await assertSource(effect, adapter, true)
    return receipt(adapter, "read")
  },
  async wait(effect, adapter, signal) {
    await assertSource(effect, adapter, true)
    if (effect.command.type !== "wait") throw new Error("Invalid wait effect")
    await adapter.wait(effect.command.timeoutMs, signal)
    return receipt(adapter, "wait")
  },
  async scroll(effect, adapter, signal) {
    await assertSource(effect, adapter, true)
    if (effect.command.type !== "scroll") {
      throw new Error("Invalid scroll effect")
    }
    await adapter.scroll(effect.command, effect.snapshotIdentity, signal)
    return receipt(adapter, "scroll")
  },
  async switch_tab(effect, adapter) {
    if (effect.command.type !== "switch_tab" || !effect.destination) {
      throw new Error("Invalid switch-tab effect")
    }
    await assertSource(effect, adapter, false)
    const target = await adapter.getTab(effect.command.tabId)
    if (!target || !exactUrl(target.url, effect.destination.url)) {
      throw new Error("Agent switch-tab destination changed")
    }
    await assertReadable(adapter, target.url)
    await adapter.activateTab(effect.command.tabId)
    return receipt(adapter, "switch_tab", effect.command.tabId)
  },
  async back(effect, adapter) {
    await assertSource(effect, adapter, false)
    if (!effect.destination) throw new Error("Unknown back destination")
    const destination = await adapter.resolveHistoryDestination(
      effect.snapshotIdentity.tabId,
      "back"
    )
    if (!exactUrl(destination, effect.destination.url)) {
      throw new Error("Agent back destination changed")
    }
    await assertReadable(adapter, destination)
    await adapter.goHistory(effect.snapshotIdentity.tabId, "back")
    return receipt(adapter, "back")
  },
  async forward(effect, adapter) {
    await assertSource(effect, adapter, false)
    if (!effect.destination) throw new Error("Unknown forward destination")
    const destination = await adapter.resolveHistoryDestination(
      effect.snapshotIdentity.tabId,
      "forward"
    )
    if (!exactUrl(destination, effect.destination.url)) {
      throw new Error("Agent forward destination changed")
    }
    await assertReadable(adapter, destination)
    await adapter.goHistory(effect.snapshotIdentity.tabId, "forward")
    return receipt(adapter, "forward")
  }
} satisfies Record<ReadOnlyAgentAction, Executor>

export const executeReadOnlyAgentEffect = async (input: {
  effect: AuthorizedAgentEffect
  adapter: AgentCommandExecutorAdapter
  signal: AgentCancellationSignal
}): Promise<AgentExecutionReceipt> => {
  const executor = READ_ONLY_AGENT_EXECUTORS[
    input.effect.command.type as ReadOnlyAgentAction
  ] as Executor | undefined
  if (!executor) throw new Error("Agent action has no read-only executor")
  return executor(input.effect, input.adapter, input.signal)
}

export const NAVIGATION_AGENT_EXECUTORS = {
  async navigate(effect, adapter) {
    if (effect.command.type !== "navigate" || !effect.destination) {
      throw new Error("Invalid navigate effect")
    }
    // The authorization the user gave names one source page and one
    // destination. Re-establishing the source here is what keeps an approval
    // from being spent on a page that changed underneath it while the run
    // waited, and the destination is taken from the resolved effect rather
    // than from the command so an approved URL is the URL that travels.
    await assertSource(effect, adapter, true)
    await assertReadable(adapter, effect.destination.url)
    await adapter.navigate(
      effect.snapshotIdentity.tabId,
      effect.destination.url
    )
    return receipt(adapter, "navigate")
  },
  async open_tab(effect, adapter) {
    if (effect.command.type !== "open_tab" || !effect.destination) {
      throw new Error("Invalid open-tab effect")
    }
    await assertSource(effect, adapter, true)
    await assertReadable(adapter, effect.destination.url)
    const opened = await adapter.createTab({
      url: effect.destination.url,
      openerTabId: effect.snapshotIdentity.tabId
    })
    if (opened?.id === undefined) {
      throw new Error("Agent open-tab produced no tab")
    }
    // The new tab is reported, not adopted: the controller moves the run onto
    // it only after verification confirms the destination it actually holds.
    return receipt(adapter, "open_tab", opened.id)
  }
} satisfies Record<NavigationAgentAction, Executor>

export const executeNavigationAgentEffect = async (input: {
  effect: AuthorizedAgentEffect
  adapter: AgentCommandExecutorAdapter
  signal: AgentCancellationSignal
}): Promise<AgentExecutionReceipt> => {
  const executor = NAVIGATION_AGENT_EXECUTORS[
    input.effect.command.type as NavigationAgentAction
  ] as Executor | undefined
  if (!executor) throw new Error("Agent action has no navigation executor")
  return executor(input.effect, input.adapter, input.signal)
}
