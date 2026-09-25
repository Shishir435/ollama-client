import type {
  AgentConversationHandoff,
  AgentPanelSnapshot,
  AgentRunState
} from "@ollama-client/contracts"
import { agentReadinessPermitsStart } from "@/application/agent/agent-model-readiness"
import { renderAgentHandoffBlock } from "@/application/context/agent-handoff-context"
import { browser } from "@/lib/browser-api"
import { classifyAgentTabAccess } from "@/lib/browser-tab-access"
import { logger } from "@/lib/logger"
import { getMessagesByIds } from "@/lib/repositories/chat-history"
import { readSetting, writeSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"
import { normalizeGrantOrigin } from "@/lib/tools/approval/approval-policy"
import type {
  BrowserTaskRequest,
  BrowserTaskRunner
} from "@/lib/tools/internal/browser-task-tool"
import type { ToolContext, ToolResult } from "@/lib/tools/types"
import { resolveAgentProviderDisclosure } from "./agent-provider-disclosure"
import {
  AgentRunError,
  type AgentRunFailureReason,
  type AgentRunService
} from "./agent-run-service"

type ProviderDisclosure = AgentPanelSnapshot["provider"]

/**
 * How long the chat turn waits for its run. A run's own active budget is
 * forty minutes and time spent waiting on the user does not count against
 * it, so a run can outlast any wait; past this the turn ends, says so, and
 * the card in the same message keeps supervising the run.
 */
export const BROWSER_TASK_WAIT_MS = 45 * 60_000

/**
 * What the model is told when a start is refused. Plain English for the
 * model to relay: the card has nothing to show for a run that never existed,
 * so this is where the user learns why, through the model's answer.
 */
const REFUSALS: Record<AgentRunFailureReason, string> = {
  already_running:
    "Another browser task is still running or paused. Tell the user to finish or stop it from its card before starting a new one.",
  turn_has_run:
    "A browser task already ran in this turn and its result is above. Do not start another now; answer from that result, and if more browser work is needed, tell the user to ask for it in a new message.",
  browser_control_unavailable:
    "The browser agent could not take control of the tab. Another debugger or DevTools may be attached; ask the user to close it and try again.",
  follow_up_unavailable:
    "The previous browser task can no longer be continued. Start it again without continue_previous_task if the user still wants it.",
  permission_denied:
    "The browser agent is missing a browser permission it needs.",
  tab_unsupported:
    "The browser agent cannot work on that tab, which is a browser page rather than a website. If the task names a site, call browser_task again with start_url set to that site's address and it opens in a new tab; otherwise ask the user to open an ordinary web page (http or https).",
  steer_unavailable:
    "The browser task is not running, so it could not take a correction.",
  unknown_run: "The browser task could not be found."
}

const failure = (content: string): ToolResult => ({ content, isError: true })

const TURN_STOPPED =
  "The user stopped this turn, so the browser task was stopped."

interface ResolvedTab {
  id: number
  url: string
}

/** What a delegated run needs from the turn; the legacy port has none. */
interface TurnLink {
  sessionId: string
  messageId: number
  providerId: string
  modelId: string
  signal?: AbortSignal
  pageFirst: boolean
  previousRunId?: string
  followUpRunId?: string
  toolCallId?: string
}

type Refusal = { ok: false; result: ToolResult }

/**
 * The run this one follows. A card's Continue or Retry names its own run, and
 * that wins whatever the model said: an older card must not continue the
 * newest run and inherit the wrong record. Otherwise the model's own
 * `continue_previous_task` picks the newest run in the branch.
 */
const followedRun = (
  request: BrowserTaskRequest,
  turn: TurnLink
): { previousRunId?: string } => {
  if (turn.followUpRunId) return { previousRunId: turn.followUpRunId }
  return request.continuePrevious && turn.previousRunId
    ? { previousRunId: turn.previousRunId }
    : {}
}

/** How long a start address may take to load before the run begins anyway. */
const START_TAB_LOAD_MS = 15_000

export interface BrowserTaskRunnerDependencies {
  service: AgentRunService
  disclose?: (
    providerId: string,
    modelId: string
  ) => Promise<ProviderDisclosure>
  getTab?: (tabId: number) => Promise<{ id?: number; url?: string } | undefined>
  activeTab?: () => Promise<{ id?: number; url?: string } | undefined>
  /** Opens a start address in a new tab and resolves once it has loaded. */
  openTab?: (url: string) => Promise<{ id?: number; url?: string } | undefined>
  readHandoff?: (
    messageId: number
  ) => Promise<AgentConversationHandoff | undefined>
  waitMs?: number
}

/**
 * The agent side of `browser_task`: which tab, whether the model may drive it,
 * what the start prompt says, and the wait for the run's answer.
 */
export const createBrowserTaskRunner = (
  dependencies: BrowserTaskRunnerDependencies
): BrowserTaskRunner => {
  const { service } = dependencies
  const disclose =
    dependencies.disclose ??
    ((providerId: string, modelId: string) =>
      resolveAgentProviderDisclosure(providerId, modelId))
  const getTab =
    dependencies.getTab ??
    (async (tabId: number) => {
      try {
        return await browser.tabs.get(tabId)
      } catch {
        return undefined
      }
    })
  /**
   * Only when the turn carried no tab of its own: the worker has no window,
   * so this is the last focused one's, which is right far more often than it
   * is wrong and is the tab the start prompt then names.
   */
  const activeTab =
    dependencies.activeTab ??
    (async () => {
      try {
        const [tab] = await browser.tabs.query({
          active: true,
          lastFocusedWindow: true
        })
        return tab
      } catch {
        return undefined
      }
    })
  const readHandoff =
    dependencies.readHandoff ??
    (async (messageId: number) => {
      const [row] = await getMessagesByIds([messageId])
      return row?.agentHandoff
    })
  const waitMs = dependencies.waitMs ?? BROWSER_TASK_WAIT_MS
  const openTab =
    dependencies.openTab ??
    (async (url: string) => {
      try {
        const created = await browser.tabs.create({ url, active: true })
        if (typeof created.id !== "number") return undefined
        /** Loaded, or as far as it got; the start refuses what is not a site. */
        for (let waited = 0; waited < START_TAB_LOAD_MS; waited += 250) {
          const tab = await getTab(created.id)
          if (tab?.url && (tab as { status?: string }).status === "complete")
            return tab
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
        return await getTab(created.id)
      } catch {
        return undefined
      }
    })

  const resolveTab = async (
    request: BrowserTaskRequest,
    ctx: ToolContext
  ): Promise<ResolvedTab | undefined> => {
    const tabId = request.tabId ?? ctx.browserTabId
    const tab = tabId !== undefined ? await getTab(tabId) : await activeTab()
    if (typeof tab?.id !== "number" || !tab.url) return undefined
    return { id: tab.id, url: tab.url }
  }

  /**
   * The tab the task can start on without opening anything. A tab the agent
   * cannot drive — a browser settings page, the new-tab page — is no tab at
   * all here, which is what lets a named start address take its place.
   */
  const usableTab = async (
    request: BrowserTaskRequest,
    ctx: ToolContext
  ): Promise<ResolvedTab | undefined> => {
    const tab = await resolveTab(request, ctx)
    return tab && (await classifyAgentTabAccess(tab.url)) === "ok"
      ? tab
      : undefined
  }

  /** Page content in the turn, or a tool result that brought some in. */
  const readPageFirst = (ctx: ToolContext): boolean =>
    ctx.pageContentInContext === true || (ctx.taintGeneration ?? 0) > 0

  const needsRemoteAcknowledgement = async (
    provider: ProviderDisclosure
  ): Promise<{ observations: boolean; screenshots: boolean }> => {
    if (provider?.location !== "remote")
      return { observations: false, screenshots: false }
    const [observations, screenshots] = await Promise.all([
      readSetting(SETTINGS.AGENT_REMOTE_OBSERVATION_ACKNOWLEDGED),
      readSetting(SETTINGS.AGENT_REMOTE_SCREENSHOT_ACKNOWLEDGED)
    ])
    return {
      observations: observations !== true,
      screenshots: provider.screenshots !== false && screenshots !== true
    }
  }

  const discloseFor = async (ctx: ToolContext): Promise<ProviderDisclosure> => {
    if (!ctx.providerId || !ctx.model) return undefined
    try {
      return await disclose(ctx.providerId, ctx.model)
    } catch {
      return undefined
    }
  }

  /** The run's answer for the model, fenced as the page data it is. */
  const report = async (
    state: AgentRunState,
    messageId: number
  ): Promise<ToolResult> => {
    const handoff = await readHandoff(messageId).catch(() => undefined)
    const block = handoff ? renderAgentHandoffBlock(handoff) : undefined
    const content =
      block ??
      `The browser task ended with status "${state.status}"${state.result ? `: ${state.result}` : "."}`
    return {
      content,
      provenance: "web-untrusted",
      ...(state.status === "failed" ? { isError: true } : {})
    }
  }

  const turnLink = (ctx: ToolContext): TurnLink | undefined =>
    ctx.sessionId &&
    ctx.assistantMessageId !== undefined &&
    ctx.providerId &&
    ctx.model
      ? {
          sessionId: ctx.sessionId,
          messageId: ctx.assistantMessageId,
          providerId: ctx.providerId,
          modelId: ctx.model,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
          pageFirst: readPageFirst(ctx),
          ...(ctx.previousAgentRunId
            ? { previousRunId: ctx.previousAgentRunId }
            : {}),
          ...(ctx.followUpRunId ? { followUpRunId: ctx.followUpRunId } : {}),
          ...(ctx.toolCallId ? { toolCallId: ctx.toolCallId } : {})
        }
      : undefined

  /**
   * Everything a start is refused for before anything is written: no turn to
   * report into, a model that cannot drive a run, a remote notice nobody was
   * shown, a tab the run may not touch or one that changed after approval.
   */
  /**
   * The tab in view when it can be driven, else the start address opened in
   * a new tab. Opened only here, after the start was approved against that
   * address's own origin — never while the prompt was being asked.
   */
  const startTab = async (
    request: BrowserTaskRequest,
    ctx: ToolContext
  ): Promise<ResolvedTab | undefined> => {
    const tab = await usableTab(request, ctx)
    if (tab || !request.startUrl) return tab
    const opened = await openTab(request.startUrl)
    return typeof opened?.id === "number" && opened.url
      ? { id: opened.id, url: opened.url }
      : undefined
  }

  const admit = async (
    request: BrowserTaskRequest,
    ctx: ToolContext
  ): Promise<
    | { ok: true; turn: TurnLink; tab: ResolvedTab; experimental: boolean }
    | Refusal
  > => {
    const turn = turnLink(ctx)
    if (!turn) {
      return {
        ok: false,
        result: failure(
          "Browser tasks can only be started from a saved chat conversation."
        )
      }
    }
    const provider = await discloseFor(ctx)
    /**
     * Tool calling the user switched on for a model that never reported it is
     * theirs to try, and the start prompt said so. Approving that prompt is
     * the same "start anyway" the old start screen asked for.
     */
    const experimental =
      provider?.readiness?.status === "experimental" &&
      ctx.userConfirmed === true
    if (!agentReadinessPermitsStart(provider?.readiness, experimental)) {
      return {
        ok: false,
        result: failure(
          "The selected model cannot drive the browser agent, which needs confirmed tool calling for every step. Tell the user to choose a model whose tool calling is confirmed."
        )
      }
    }
    const remote = await needsRemoteAcknowledgement(provider)
    if (remote.observations || remote.screenshots) {
      /**
       * The start prompt carried the notice, so approving it is the
       * acknowledgement. A call that reached here unasked has not been shown
       * it, and a remote model is not sent a page on a guess.
       */
      if (!ctx.userConfirmed) {
        return {
          ok: false,
          result: failure(
            "The user has not yet agreed to send page content to this remote model."
          )
        }
      }
      await writeSetting(SETTINGS.AGENT_REMOTE_OBSERVATION_ACKNOWLEDGED, true)
      if (remote.screenshots)
        await writeSetting(SETTINGS.AGENT_REMOTE_SCREENSHOT_ACKNOWLEDGED, true)
    }
    const tab = await startTab(request, ctx)
    if (!tab || (await classifyAgentTabAccess(tab.url)) !== "ok") {
      return { ok: false, result: failure(REFUSALS.tab_unsupported) }
    }
    if (
      ctx.approvedOrigin &&
      normalizeGrantOrigin(tab.url) !== ctx.approvedOrigin
    ) {
      return {
        ok: false,
        result: failure(
          "The tab changed after the user approved the task. Ask again on the page they are looking at now."
        )
      }
    }
    return { ok: true, turn, tab, experimental }
  }

  const start = async (
    request: BrowserTaskRequest,
    turn: TurnLink,
    admitted: { tab: ResolvedTab; experimental: boolean }
  ): Promise<{ ok: true; state: AgentRunState } | Refusal> => {
    const mode = await readSetting(SETTINGS.AGENT_PERMISSION_MODE)
    try {
      const state = await service.delegate({
        goal: request.goal,
        tabId: admitted.tab.id,
        providerId: turn.providerId,
        modelId: turn.modelId,
        sessionId: turn.sessionId,
        messageId: turn.messageId,
        goalAuthor: turn.pageFirst ? "model_after_page" : "model",
        ...(turn.toolCallId ? { toolCallId: turn.toolCallId } : {}),
        allowRoutineActions: mode !== "approve_each",
        ...(admitted.experimental ? { allowExperimentalModel: true } : {}),
        ...followedRun(request, turn)
      })
      return { ok: true, state }
    } catch (error) {
      if (error instanceof AgentRunError)
        return { ok: false, result: failure(REFUSALS[error.reason]) }
      logger.error("Browser task could not start", "Agent", {
        name: error instanceof Error ? error.name : typeof error
      })
      return { ok: false, result: failure("The browser task could not start.") }
    }
  }

  /**
   * The run's answer, or why there is none yet. A turn stopped by the user
   * stops the run with it: nobody is left to read the answer, and a run
   * nobody reads should not keep driving a tab.
   */
  const wait = async (
    state: AgentRunState,
    turn: TurnLink
  ): Promise<ToolResult> => {
    const waiting = new AbortController()
    const timer = setTimeout(() => waiting.abort("wait_elapsed"), waitMs)
    const onTurnAbort = () => waiting.abort("turn_aborted")
    /**
     * A stop that landed while the run was being admitted fired before this
     * listener existed; the run it started is stopped all the same.
     */
    if (turn.signal?.aborted) onTurnAbort()
    else turn.signal?.addEventListener("abort", onTurnAbort, { once: true })
    try {
      const settled = await service.awaitSettled(state.id, waiting.signal)
      return report(settled, turn.messageId)
    } catch (error) {
      if (waiting.signal.reason === "wait_elapsed") {
        return {
          content:
            "The browser task is still running and is shown to the user in this conversation. Tell the user it continues there; its result will be available to later messages.",
          provenance: "trusted"
        }
      }
      if (turn.signal?.aborted) {
        await service.stop(state.id).catch((stopError: unknown) => {
          logger.warn(
            "Browser task stop after an abandoned turn failed",
            "Agent",
            {
              runId: state.id,
              name:
                stopError instanceof Error ? stopError.name : typeof stopError
            }
          )
        })
        return failure(TURN_STOPPED)
      }
      logger.warn("Browser task wait failed", "Agent", {
        runId: state.id,
        name: error instanceof Error ? error.name : typeof error
      })
      return failure("The browser task stopped without a result.")
    } finally {
      clearTimeout(timer)
      turn.signal?.removeEventListener("abort", onTurnAbort)
    }
  }

  return {
    async origin(request, ctx) {
      const tab = await usableTab(request, ctx)
      if (tab) return normalizeGrantOrigin(tab.url)
      return request.startUrl
        ? normalizeGrantOrigin(request.startUrl)
        : normalizeGrantOrigin((await resolveTab(request, ctx))?.url)
    },

    async confirmation(request, ctx) {
      const provider = await discloseFor(ctx)
      const remote = await needsRemoteAcknowledgement(provider)
      const otherTab =
        request.tabId !== undefined && request.tabId !== ctx.browserTabId
      const afterPage = readPageFirst(ctx)
      const experimental = provider?.readiness?.status === "experimental"
      const notes = [
        ...(afterPage ? ["agent.start_gate.after_page"] : []),
        ...(experimental ? ["agent.start_gate.experimental_model"] : []),
        ...(otherTab ? ["agent.start_gate.other_tab"] : []),
        ...(remote.screenshots
          ? ["agent.privacy.remote_notice_screenshots"]
          : remote.observations
            ? ["agent.privacy.remote_notice"]
            : []),
        "agent.start_gate.supervised"
      ]
      return {
        always:
          afterPage ||
          otherTab ||
          experimental ||
          remote.observations ||
          remote.screenshots,
        summary: request.goal,
        notes
      }
    },

    async run(request, ctx) {
      const admitted = await admit(request, ctx)
      if (!admitted.ok) return admitted.result
      if (ctx.signal?.aborted) return failure(TURN_STOPPED)
      const started = await start(request, admitted.turn, admitted)
      if (!started.ok) return started.result
      return wait(started.state, admitted.turn)
    }
  }
}
