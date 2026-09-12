import type {
  AgentController,
  AgentModelPort,
  AgentPersistencePort
} from "@ollama-client/agent-runtime"
import {
  createAgentController,
  evaluateAgentPolicy
} from "@ollama-client/agent-runtime"

import type { AgentRunState } from "@ollama-client/contracts"

import { createProviderAgentModelPort } from "@/application/agent/agent-model-port"
import { logger } from "@/lib/logger"
import { readStoredSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"
import { createAgentBrowserAdapters } from "./agent-browser-adapters"
import type { AgentBrowserSessionManager } from "./agent-browser-session-manager"
import type { AgentControlSessionRegistry } from "./agent-control-sessions"
import { createAgentEffectPort } from "./agent-effect-port"
import { resolveAgentProviderDisclosure } from "./agent-provider-disclosure"
import type { AgentSupervision } from "./agent-supervision"
import type { AgentTabHistory } from "./agent-tab-history"
import { traceAgentRun } from "./agent-trace"

/**
 * How long one decision may take before the run gives up on it.
 *
 * The runtime records deadlines but enforces none: a provider that accepts the
 * request and never answers leaves the run in `deciding` with a panel that
 * says "Choosing next step" and never changes. A local model reading a large
 * page is genuinely slow, so this is generous — it exists to turn a hang into
 * a reported failure, not to police latency.
 */
const DECISION_TIMEOUT_MS = 120_000

const withDecisionTimeout = (
  model: AgentModelPort,
  timeoutMs: number
): AgentModelPort => ({
  ...(model.vision ? { vision: model.vision.bind(model) } : {}),
  async decide(input, signal) {
    const scope = new AbortController()
    let timedOut = false
    const abort = () => scope.abort()
    if (signal.aborted) scope.abort()
    else signal.addEventListener?.("abort", abort, { once: true })
    const timer = setTimeout(() => {
      timedOut = true
      abort()
    }, timeoutMs)
    const startedAt = Date.now()
    try {
      const decision = await model.decide(input, scope.signal)
      logger.info("Agent decision received", "Agent", {
        runId: input.state.id,
        model: input.state.modelId,
        elapsedMs: Date.now() - startedAt,
        decision: decision.type
      })
      return decision
    } catch (error) {
      /*
       * A decision that ends without an answer is the hardest failure to read
       * from the outside: an aborted stream looks the same whether the run was
       * stopped, the bound deadline fired, or something else cancelled it. The
       * three are recorded apart here so the next one does not need a HAR.
       */
      logger.warn("Agent decision failed", "Agent", {
        runId: input.state.id,
        model: input.state.modelId,
        elapsedMs: Date.now() - startedAt,
        cancelledByRun: signal.aborted,
        timedOut,
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : "unknown"
      })
      throw error
    } finally {
      clearTimeout(timer)
      signal.removeEventListener?.("abort", abort)
    }
  }
})

export interface BuildAgentControllerInput {
  runId: string
  sessions: AgentControlSessionRegistry
  /** Absent means no native input: every action runs on the DOM backend. */
  browserSessions?: AgentBrowserSessionManager
  history: AgentTabHistory
  persistence: AgentPersistencePort
  supervision: AgentSupervision
  allowExperimentalModel: boolean
  now(): number
  decisionTimeoutMs?: number
  /**
   * Whether a picture may reach this run's provider. Defaults to: the provider
   * answers on this device, or the user acknowledged the screenshot notice.
   * Enforced here, not only in the panel, so a model whose vision resolved
   * after the panel disclosed a text-only run still sends nothing.
   */
  screenshotsPermitted?: (state: AgentRunState) => Promise<boolean>
}

const defaultScreenshotsPermitted = async (
  state: AgentRunState
): Promise<boolean> => {
  const disclosure = await resolveAgentProviderDisclosure(
    state.providerId,
    state.modelId
  )
  if (disclosure?.location === "local") return true
  return (
    (await readStoredSetting(SETTINGS.AGENT_REMOTE_SCREENSHOT_ACKNOWLEDGED)) ===
    true
  )
}

export type BuildAgentController = (
  input: BuildAgentControllerInput
) => AgentController

/**
 * Binds one run's controller to this browser.
 *
 * Kept apart from the run service so lifecycle and assembly stay separable —
 * a test can drive the service with its own controller, and the layers below
 * are reachable without it. The split buys no load-time saving today: the
 * Chrome service worker is a classic worker, so WXT inlines the dynamic
 * import into background.js.
 */
export const buildAgentController: BuildAgentController = (input) => {
  const adapters = createAgentBrowserAdapters({
    runId: input.runId,
    sessions: input.sessions,
    browserSessions: input.browserSessions,
    history: input.history,
    now: input.now
  })

  const model = withDecisionTimeout(
    createProviderAgentModelPort({
      allowExperimental: input.allowExperimentalModel
    }),
    input.decisionTimeoutMs ?? DECISION_TIMEOUT_MS
  )
  const effect = createAgentEffectPort(adapters)
  const screenshotsPermitted =
    input.screenshotsPermitted ?? defaultScreenshotsPermitted
  const vision = model.vision
  return createAgentController({
    trace: traceAgentRun,
    ...(adapters.screenshot ? { screenshot: adapters.screenshot } : {}),
    model: {
      ...(vision
        ? {
            async vision(state, signal) {
              if (!(await vision(state, signal))) return false
              const permitted = await screenshotsPermitted(state)
              if (!permitted) {
                traceAgentRun(input.runId, "screenshot_withheld", {
                  reason: "not_acknowledged"
                })
              }
              return permitted
            }
          }
        : {}),
      async decide(request, signal) {
        traceAgentRun(input.runId, "deciding", {
          step: request.state.stepCount + 1,
          providerId: request.state.providerId,
          modelId: request.state.modelId,
          screenshot: request.screenshot !== undefined
        })
        const decision = await model.decide(request, signal)
        traceAgentRun(input.runId, "decision", {
          type: decision.type,
          action:
            decision.type === "command" ? decision.command.type : undefined
        })
        return decision
      }
    },
    observation: {
      async observe(request, signal) {
        traceAgentRun(input.runId, "observing", { tabId: request.tabId })
        const observation = await adapters.observation.observe(request, signal)
        traceAgentRun(input.runId, "observed", {
          tabId: observation.tabId,
          documentId: observation.documentId,
          generation: observation.generation,
          snapshotId: observation.snapshotId,
          elements: observation.elements.length
        })
        return observation
      }
    },
    effect: {
      async resolve(command, observation, context) {
        const resolved = await effect.resolve(command, observation, context)
        traceAgentRun(input.runId, "resolved", {
          action: command.type,
          ref: resolved.target.ref,
          snapshotId: observation.snapshotId,
          visual: resolved.target.point !== undefined
        })
        return resolved
      },
      async execute(authorized, signal) {
        traceAgentRun(input.runId, "executing", {
          action: authorized.command.type,
          authorization: authorized.authorization.type
        })
        const receipt = await effect.execute(authorized, signal)
        traceAgentRun(input.runId, "executed", {
          action: authorized.command.type,
          executedAt: receipt.executedAt,
          backend: receipt.backend,
          inputDelivery: receipt.inputDelivery
        })
        return receipt
      },
      async verify(request, signal) {
        const result = await effect.verify(request, signal)
        traceAgentRun(input.runId, "verified", {
          outcome: result.outcome,
          kind: result.evidence.kind
        })
        return result
      }
    },
    policy: {
      evaluate(request) {
        const decision = evaluateAgentPolicy(request)
        traceAgentRun(input.runId, "policy", {
          outcome: decision.type,
          risk: decision.risk
        })
        return decision
      }
    },
    persistence: input.persistence,
    approval: input.supervision.approval,
    takeover: input.supervision.takeover,
    clock: { now: input.now, wait: adapters.executor.wait }
  })
}
