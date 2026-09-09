import type {
  AgentCancellationSignal,
  AgentObservationPort,
  AuthorizedAgentEffect
} from "@ollama-client/agent-runtime"
import type { AgentSnapshotIdentity } from "@ollama-client/contracts"

import type { AgentCommandExecutorAdapter } from "@/lib/browser-agent/command-executor"
import type { AgentDomMutationInstruction } from "@/lib/browser-agent/control-port"
import type { AgentEffectVerifierAdapter } from "@/lib/browser-agent/effect-verifier"
import type { AgentEffectResolverAdapter } from "@/lib/browser-agent/resolved-effect"
import { browser } from "@/lib/browser-api"
import {
  classifyAgentTabAccess,
  queryActiveTab
} from "@/lib/browser-tab-access"
import type { AgentControlSessionRegistry } from "./agent-control-sessions"
import { waitForAgentNavigation } from "./agent-navigation-settlement"
import type { AgentTabHistory } from "./agent-tab-history"

export interface AgentBrowserAdapters {
  observation: AgentObservationPort
  resolver: AgentEffectResolverAdapter
  executor: AgentCommandExecutorAdapter
  verifier: AgentEffectVerifierAdapter
}

/**
 * Bridges the run-neutral resolver, executor and verifier ports to Chromium.
 *
 * Every adapter is built for one run: the control port is bound to that run's
 * id, so a tab handle cannot be shared with another run, and page-side work
 * (scroll, DOM mutation, observation) goes through the same bound session
 * rather than a fresh injection.
 */
export const createAgentBrowserAdapters = (input: {
  runId: string
  sessions: AgentControlSessionRegistry
  history: AgentTabHistory
  now?: () => number
}): AgentBrowserAdapters => {
  const now = input.now ?? (() => Date.now())

  const abortSignal = (
    signal: AgentCancellationSignal
  ): AbortSignal | undefined => {
    const controller = new AbortController()
    if (signal.aborted) {
      controller.abort()
      return controller.signal
    }
    signal.addEventListener?.("abort", () => controller.abort(), { once: true })
    return controller.signal
  }

  const mutationInstruction = (
    effect: AuthorizedAgentEffect
  ): AgentDomMutationInstruction => {
    if (!effect.target.ref || !effect.target.tag) {
      throw new Error("Agent mutation target is not an observed element")
    }
    // The frame identity travels as the instruction's own field, never inside
    // the wire target: that target is validated by a strict schema with no
    // `frame` key, so leaking it there is a parse failure before a byte is sent.
    const { frame: targetFrame, ...target } = effect.target
    const frame = targetFrame ?? effect.snapshotIdentity
    return {
      command: effect.command,
      target: { ...target, ref: effect.target.ref, frameId: frame.frameId },
      snapshotIdentity: effect.snapshotIdentity,
      frame
    } as AgentDomMutationInstruction
  }

  const getTab = async (tabId: number) => {
    try {
      return await browser.tabs.get(tabId)
    } catch {
      return undefined
    }
  }

  const resolveHistoryDestination = async (
    tabId: number,
    direction: "back" | "forward"
  ) => input.history.resolveDestination(tabId, direction)

  const observe = (
    tabId: number,
    minimumGeneration: number,
    allowedOrigins: readonly string[],
    signal: AgentCancellationSignal
  ) =>
    input.sessions.observe(
      { runId: input.runId, tabId, minimumGeneration, allowedOrigins },
      abortSignal(signal)
    )

  return {
    observation: {
      observe: (request, signal) =>
        observe(
          request.tabId,
          request.minimumGeneration,
          request.allowedOrigins,
          signal
        )
    },
    resolver: {
      getTab,
      classifyAccess: classifyAgentTabAccess,
      resolveHistoryDestination
    },
    executor: {
      getTab,
      async getFrame(tabId, frameId) {
        const frame = (await browser.webNavigation.getFrame({
          tabId,
          frameId
        })) as { documentId?: string; url: string } | null
        return frame ? { documentId: frame.documentId, url: frame.url } : null
      },
      classifyAccess: classifyAgentTabAccess,
      async scroll(
        command,
        identity: AgentSnapshotIdentity,
        frame: AgentSnapshotIdentity,
        signal: AgentCancellationSignal
      ) {
        await input.sessions.executeScroll(
          {
            runId: input.runId,
            tabId: identity.tabId,
            instruction: { command, snapshotIdentity: identity, frame }
          },
          abortSignal(signal)
        )
      },
      async mutate(effect, signal) {
        return input.sessions.executeDomMutation(
          {
            runId: input.runId,
            tabId: effect.snapshotIdentity.tabId,
            instruction: mutationInstruction(effect)
          },
          abortSignal(signal)
        )
      },
      async activateTab(tabId) {
        await browser.tabs.update(tabId, { active: true })
      },
      async goHistory(tabId, direction) {
        if (direction === "back") {
          await browser.tabs.goBack(tabId)
          return
        }
        await browser.tabs.goForward(tabId)
      },
      resolveHistoryDestination,
      wait: (ms, signal) =>
        new Promise<void>((resolve, reject) => {
          if (signal.aborted) {
            reject(new Error("Agent wait cancelled"))
            return
          }
          const timer = setTimeout(() => {
            signal.removeEventListener?.("abort", onAbort)
            resolve()
          }, ms)
          const onAbort = () => {
            clearTimeout(timer)
            reject(new Error("Agent wait cancelled"))
          }
          signal.addEventListener?.("abort", onAbort, { once: true })
        }),
      async navigate(tabId, url) {
        await browser.tabs.update(tabId, { url })
      },
      async createTab({ url, openerTabId }) {
        return browser.tabs.create({ url, openerTabId, active: false })
      },
      now
    },
    verifier: {
      observe,
      waitForNavigation: (tabId, sourceUrl, destinationUrl, signal) =>
        waitForAgentNavigation({
          tabId,
          sourceUrl,
          destinationUrl,
          signal,
          getTab
        }),
      async getActiveTabId() {
        return (await queryActiveTab())?.id
      },
      getTab,
      classifyAccess: classifyAgentTabAccess,
      now
    }
  }
}
