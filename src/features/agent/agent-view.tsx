import {
  type AgentApprovalRequest,
  type AgentBrowserDisclosure,
  type AgentRunState,
  type AgentStepRecord,
  type AgentTakeoverRequest,
  MAX_AGENT_OBSERVATIONS
} from "@ollama-client/contracts"
import { Bot, Eye, MessageSquareWarning } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { AgentApprovalCard } from "./components/agent-approval-card"
import { AgentBrowserDisclosureCard } from "./components/agent-browser-disclosure-card"
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
  busy?: boolean
  /** The unsent goal. Held by the caller so it survives leaving the surface. */
  goal?: string
  onGoalChange?: (goal: string) => void
  /** Acknowledges the notice shown: observations alone, or observations and screenshots. */
  onAcknowledgePrivacy?: (scope: "observations" | "screenshots") => void
  /** The separate acknowledgement that screenshots may reach a remote model. */
  screenshotsAcknowledged?: boolean
  onStart?: (goal: string) => void
  /** `scope` widens the approval to this origin for the rest of the run. */
  onApprove?: (scope?: "run_origin") => void
  onReject?: () => void
  onAnswer?: (text: string) => void
  onPause?: () => void
  onResume?: () => void
  onStop?: () => void
  onTakeoverComplete?: () => void
  onFeedback?: () => void
}

const noop = () => undefined

const pauseNoticeFor = (reason?: AgentRunState["pauseReason"]) => {
  if (reason === "unresolved_effect") {
    return {
      messageKey: "agent.unresolved",
      className: "border-destructive/30 bg-destructive/10"
    }
  }
  if (reason === "browser_disconnected") {
    return {
      messageKey: "agent.browser_disconnected",
      className: "border-status-warning/40 bg-status-warning/10"
    }
  }
  return undefined
}

export const AgentView = ({
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
  onStop = noop,
  onTakeoverComplete = noop,
  onFeedback = noop
}: AgentViewProps) => {
  const { t } = useTranslation()
  const settled =
    run !== null && ["completed", "failed", "cancelled"].includes(run.status)
  const remoteNeedsAcknowledgement = needsRemoteAcknowledgement(
    provider,
    privacyAcknowledged,
    screenshotsAcknowledged
  )
  const pauseNotice = pauseNoticeFor(run?.pauseReason)
  const currentAction = currentAgentAction(steps)
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

        {(!run || settled) && (
          <section className="space-y-2" aria-labelledby="agent-goal-label">
            <label
              id="agent-goal-label"
              htmlFor="agent-goal"
              className="text-xs font-medium">
              {t("agent.start.goal")}
            </label>
            <Textarea
              id="agent-goal"
              value={goal}
              maxLength={20_000}
              placeholder={t("agent.start.placeholder")}
              onChange={(event) => onGoalChange(event.target.value)}
            />
            {remoteNeedsAcknowledgement && (
              <div className="rounded-panel border border-status-warning/40 bg-status-warning/10 p-2.5 text-xs">
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
            <Button
              type="button"
              disabled={!canStart}
              onClick={() => onStart?.(goal.trim())}>
              {t("agent.start.action")}
            </Button>
          </section>
        )}

        {approval && run?.status === "awaiting_approval" && (
          <AgentApprovalCard
            onApprove={onApprove}
            onReject={onReject}
            request={approval}
          />
        )}

        {run?.question && run.status === "paused" && (
          <AgentQuestionCard onAnswer={onAnswer} question={run.question.text} />
        )}

        {takeover && run?.status === "awaiting_takeover" && (
          <section className="mb-3 rounded-panel border border-app-primary/40 bg-app-primary-soft/40 p-2.5 text-xs">
            <h2 className="font-medium">{t("agent.takeover.title")}</h2>
            <p className="mt-1 break-words text-muted-foreground">
              {agentPlainText(takeover.instruction, AGENT_PAGE_TEXT_LIMIT)}
            </p>
          </section>
        )}

        {pauseNotice && (
          <section
            className={`mb-3 flex gap-2 rounded-panel border p-2.5 text-xs ${pauseNotice.className}`}
            role="alert">
            <MessageSquareWarning
              className="icon-sm shrink-0"
              aria-hidden="true"
            />
            <p>{t(pauseNotice.messageKey)}</p>
          </section>
        )}

        <AgentWorkLog items={toAgentWorkLog(steps)} />

        {settled && run && (
          <AgentOutcomeCard
            run={run}
            providerName={provider?.name ?? run.providerId}
            onFeedback={onFeedback}
          />
        )}
      </div>

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
