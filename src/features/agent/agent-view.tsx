import {
  type AgentApprovalRequest,
  type AgentBrowserDisclosure,
  type AgentRunState,
  type AgentStepRecord,
  type AgentTakeoverRequest,
  MAX_AGENT_OBSERVATIONS
} from "@ollama-client/contracts"
import { Bot, Eye, MessageSquareWarning } from "lucide-react"
import { type ReactNode, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { AgentApprovalCard } from "./components/agent-approval-card"
import { AgentBrowserDisclosureCard } from "./components/agent-browser-disclosure-card"
import { AgentGoalComposer } from "./components/agent-goal-composer"
import { AgentOutcomeCard } from "./components/agent-outcome-card"
import { AgentQuestionCard } from "./components/agent-question-card"
import { AgentRunControls } from "./components/agent-run-controls"
import { AgentRunDetailsCard } from "./components/agent-run-details-card"
import { AgentWorkLog } from "./components/agent-work-log"
import {
  AGENT_PAGE_TEXT_LIMIT,
  agentPlainText,
  currentAgentAction,
  toAgentWorkLog
} from "./lib/presentation"

export interface AgentProviderPresentation {
  name: string
  model: string
  location: "local" | "remote"
  /** Whether viewport screenshots travel with observations; absent is unknown. */
  screenshots?: boolean
}

/**
 * Whether pictures may travel to this provider. Unknown counts as "may": the
 * runtime resolves the model's vision on its own, so a notice that stayed
 * silent about screenshots while the answer was pending would be one the user
 * never saw before a picture left.
 */
export const agentScreenshotsMayTravel = (
  provider?: AgentProviderPresentation
): boolean => provider?.screenshots !== false

/**
 * A remote provider needs the observation acknowledgement, and the screenshot
 * one too whenever pictures may travel.
 */
const needsRemoteAcknowledgement = (
  provider: AgentProviderPresentation | undefined,
  observationsAcknowledged: boolean,
  screenshotsAcknowledged: boolean
): boolean =>
  provider?.location === "remote" &&
  (!observationsAcknowledged ||
    (agentScreenshotsMayTravel(provider) && !screenshotsAcknowledged))

const remoteNoticeKey = (provider?: AgentProviderPresentation): string =>
  agentScreenshotsMayTravel(provider)
    ? "agent.privacy.remote_notice_screenshots"
    : "agent.privacy.remote_notice"

export interface AgentTabPresentation {
  title: string
  url: string
}

export interface AgentViewProps {
  run?: AgentRunState | null
  steps?: AgentStepRecord[]
  provider?: AgentProviderPresentation
  /** What this browser lets a run do; absent while it is still unknown. */
  browser?: AgentBrowserDisclosure
  tab?: AgentTabPresentation
  approval?: AgentApprovalRequest
  takeover?: AgentTakeoverRequest
  privacyAcknowledged?: boolean
  /** The surface toggle, rendered in the panel's own control row. */
  leading?: ReactNode
  busy?: boolean
  /** The unsent goal. Held by the caller so it survives leaving the surface. */
  goal?: string
  onGoalChange?: (goal: string) => void
  /** Acknowledges the notice shown: observations alone, or observations and screenshots. */
  onAcknowledgePrivacy?: (scope: "observations" | "screenshots") => void
  /** The separate acknowledgement that screenshots may reach a remote model. */
  screenshotsAcknowledged?: boolean
  onStart?: (goal: string, allowRoutineActions: boolean) => void
  /** `scope` widens the approval to this origin for the rest of the run. */
  onApprove?: (scope?: "run_origin") => void
  onReject?: () => void
  onAnswer?: (text: string) => void
  onPause?: () => void
  onResume?: () => void
  onCorrect?: (text: string) => void
  onStop?: () => void
  onTakeoverComplete?: () => void
  onResolveEffect?: () => void
  onFeedback?: () => void
  onExport?: () => void
}

const noop = () => undefined

const pauseNoticeFor = (reason?: AgentRunState["pauseReason"]) => {
  if (reason === "unresolved_effect") {
    return {
      messageKey: "agent.unresolved",
      className: "border-destructive/30 bg-tint-danger"
    }
  }
  if (reason === "browser_disconnected") {
    return {
      messageKey: "agent.browser_disconnected",
      className: "border-status-warning/40 bg-tint-warning"
    }
  }
  return undefined
}

/**
 * The phase, shown as the work log's last row while no step names the action.
 *
 * An open step is already a row of its own, so repeating it here would say the
 * same thing three times over — header, live row, log row. What this covers is
 * observing and deciding, which have no receipt yet and left the panel a title
 * above a screen of nothing at the one moment a person watches it hardest.
 */
const liveStatusRow = ({
  run,
  settled,
  named,
  t
}: {
  run?: AgentRunState | null
  settled: boolean
  named: boolean
  t: (key: string) => string
}): string | undefined =>
  run && !settled && !named ? t(`agent.status.${run.status}`) : undefined

/**
 * How far into its budget a run is.
 *
 * The count says one of fifty; the bar says what that looks like. A
 * supervisor wants to know whether a run is early or about to be cut off, and
 * reading two numbers to work that out is arithmetic a shape does for free.
 */
const AgentProgressBar = ({ used }: { used: number }) => (
  <div
    className="mb-3 h-1 overflow-hidden rounded-full bg-muted"
    aria-hidden="true">
    <div
      className="h-full rounded-full bg-app-agent transition-[width] duration-500"
      style={{
        width: `${Math.min(100, Math.round((used / MAX_AGENT_OBSERVATIONS) * 100))}%`
      }}
    />
  </div>
)

export const AgentView = ({
  leading,
  run = null,
  steps = [],
  provider,
  browser,
  tab,
  approval,
  takeover,
  privacyAcknowledged = false,
  screenshotsAcknowledged = false,
  busy = false,
  goal = "",
  onGoalChange = () => undefined,
  onAcknowledgePrivacy = noop,
  onStart,
  onApprove = noop,
  onReject = noop,
  onAnswer = noop,
  onPause = noop,
  onResume = noop,
  onCorrect,
  onStop = noop,
  onTakeoverComplete = noop,
  onResolveEffect,
  onFeedback = noop,
  onExport
}: AgentViewProps) => {
  const { t } = useTranslation()
  const [allowRoutineActions, setAllowRoutineActions] = useState(true)
  const settled =
    run !== null && ["completed", "failed", "cancelled"].includes(run.status)
  const remoteNeedsAcknowledgement = needsRemoteAcknowledgement(
    provider,
    privacyAcknowledged,
    screenshotsAcknowledged
  )
  const pauseNotice = pauseNoticeFor(run?.pauseReason)
  const startable = !run || settled
  const currentAction = currentAgentAction(steps)
  const liveRow = liveStatusRow({
    run,
    settled,
    named: Boolean(currentAction),
    t
  })
  const canStart =
    Boolean(onStart && provider && tab && goal.trim()) &&
    !remoteNeedsAcknowledgement &&
    !busy

  return (
    <main className="flex h-full min-h-0 flex-col bg-surface-chat">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <header className="mb-3 flex min-w-0 items-start gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-control bg-app-primary-soft text-app-agent">
            <Bot className="icon-sm" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="font-semibold">{t("agent.title")}</h1>
            <p className="text-xs text-muted-foreground">
              {run
                ? t(`agent.status.${run.status}`)
                : t("agent.start.description")}
            </p>
            {/* The status is the machine's word for it; a supervisor needs
                the action, named the way the log names it. */}
            {run && !settled && currentAction && (
              <p className="mt-0.5 truncate text-xs">
                {t(currentAction.key, currentAction.values)}
              </p>
            )}
          </div>
          {run && (
            <span className="shrink-0 rounded-control bg-muted px-1.5 py-0.5 text-micro">
              {/* A bare count cannot say whether a run is halfway or about to
                  be cut off, so the ceiling that stops it is shown with it. */}
              {t("agent.progress", {
                count: run.observationCount,
                budget: MAX_AGENT_OBSERVATIONS
              })}
            </span>
          )}
        </header>

        {/*
          The count says one of fifty; the bar says what that looks like. A
          supervisor watching a run wants to know whether it is early or about
          to be cut off, and reading two numbers to work that out is the kind
          of arithmetic a shape does for free.
        */}
        {run && !settled && <AgentProgressBar used={run.observationCount} />}

        <AgentRunDetailsCard provider={provider} run={run} tab={tab} />

        {/*
          What the browser will do, before anything is asked of it. Chromium
          shows its own debugging banner the moment a run attaches, and a
          banner with nothing beside it is what sends someone to ask a
          developer.
        */}
        {(!run || settled) && browser && (
          <AgentBrowserDisclosureCard browser={browser} />
        )}

        {/*
          The goal, while the run is working on it. It was on screen only in
          the box it was typed into, which the running panel replaces — so the
          one question a supervisor is answering, "is it still doing what I
          asked", had to be answered from memory.
        */}
        {run && !settled && (
          <section
            className="mb-3 rounded-panel border border-border p-2.5"
            aria-labelledby="agent-running-goal-label">
            <h2
              id="agent-running-goal-label"
              className="text-2xs font-medium text-muted-foreground">
              {t("agent.running_goal")}
            </h2>
            <p className="mt-0.5 wrap-break-word text-xs">
              {agentPlainText(run.goal, AGENT_PAGE_TEXT_LIMIT)}
            </p>
          </section>
        )}

        {(!run || settled) && (
          /* The goal's own label lives on the composer that holds it; what
             is left here is the consent this run needs before it starts. */
          <section className="space-y-2">
            <label className="flex items-start gap-2 rounded-panel border border-border p-2.5 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={allowRoutineActions}
                onChange={(event) =>
                  setAllowRoutineActions(event.target.checked)
                }
              />
              <span>
                <span className="font-medium">
                  {t("agent.start.auto_actions")}
                </span>
                <span className="mt-1 block text-muted-foreground">
                  {t("agent.start.auto_actions_description")}
                </span>
              </span>
            </label>
            {remoteNeedsAcknowledgement && (
              <div className="rounded-panel border border-status-warning/40 bg-tint-warning p-2.5 text-xs">
                <p>{t(remoteNoticeKey(provider))}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() =>
                    onAcknowledgePrivacy(
                      agentScreenshotsMayTravel(provider)
                        ? "screenshots"
                        : "observations"
                    )
                  }>
                  <Eye className="icon-xs" aria-hidden="true" />
                  {t("agent.privacy.acknowledge")}
                </Button>
              </div>
            )}
          </section>
        )}

        {approval && run?.status === "awaiting_approval" && (
          <AgentApprovalCard
            onApprove={onApprove}
            onReject={onReject}
            request={approval}
          />
        )}

        {run?.status === "paused" &&
          run.pauseReason === "user" &&
          onCorrect && (
            <AgentQuestionCard
              question={t("agent.correction")}
              onAnswer={onCorrect}
            />
          )}

        {run?.question && run.status === "paused" && (
          <AgentQuestionCard onAnswer={onAnswer} question={run.question.text} />
        )}

        {takeover && run?.status === "awaiting_takeover" && (
          <section className="mb-3 rounded-panel border border-app-primary/40 bg-app-primary-soft/40 p-2.5 text-xs">
            <h2 className="font-medium">{t("agent.takeover.title")}</h2>
            <p className="mt-1 wrap-break-word text-muted-foreground">
              {agentPlainText(takeover.instruction, AGENT_PAGE_TEXT_LIMIT)}
            </p>
          </section>
        )}

        {pauseNotice && (
          <section
            className={`mb-3 rounded-panel border p-2.5 text-xs ${pauseNotice.className}`}
            role="alert">
            <div className="flex gap-2">
              <MessageSquareWarning
                className="icon-sm shrink-0"
                aria-hidden="true"
              />
              <p>{t(pauseNotice.messageKey)}</p>
            </div>
            {/**
             * The way out of an unresolved effect. Nothing is replayed: the
             * run looks at the page again and decides from what is there.
             * Without it the only exit was to stop and start the whole goal
             * over, which is what actually risked repeating the action.
             */}
            {run?.pauseReason === "unresolved_effect" && onResolveEffect && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={onResolveEffect}>
                {t("agent.unresolved_reviewed")}
              </Button>
            )}
          </section>
        )}

        <AgentWorkLog items={toAgentWorkLog(steps)} live={liveRow} />
        {run && onExport && (
          <Button type="button" variant="outline" size="sm" onClick={onExport}>
            {t("agent.export_report")}
          </Button>
        )}

        {settled && run && (
          <AgentOutcomeCard
            run={run}
            providerName={provider?.name ?? run.providerId}
            onFeedback={onFeedback}
          />
        )}
      </div>

      {/*
        The control row the chat surface has at the bottom of its composer.
        This panel has no message to compose, so it carries only the controls
        that are not about one: the surface toggle and the model the run will
        use, composed by the panel — which had no picker here at all, so
        changing the model meant leaving for the chat surface and coming back.
      */}
      {/*
        Always rendered: the goal is this surface's own input, not something
        the side panel lends it. Gating the whole composer on the toggle being
        passed meant a view rendered without one had no way to start a run at
        all.
      */}
      <AgentGoalComposer
        startable={startable}
        goal={goal}
        canStart={canStart}
        controls={leading}
        onGoalChange={onGoalChange}
        onStart={() => onStart?.(goal.trim(), allowRoutineActions)}
      />

      {run && !settled && (
        <AgentRunControls
          status={run.status}
          resumeDisabled={
            run.pauseReason === "unresolved_effect" ||
            run.pauseReason === "question"
          }
          onPause={onPause}
          onResume={onResume}
          onStop={onStop}
          onTakeoverComplete={onTakeoverComplete}
        />
      )}
    </main>
  )
}
