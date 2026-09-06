import type {
  AgentApprovalRequest,
  AgentRunState,
  AgentStepRecord,
  AgentTakeoverRequest
} from "@ollama-client/contracts"
import { Bot, ExternalLink, Eye, MessageSquareWarning } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { AgentRunControls } from "./components/agent-run-controls"
import { AgentWorkLog } from "./components/agent-work-log"
import {
  AGENT_PAGE_TEXT_LIMIT,
  agentPlainText,
  toAgentWorkLog
} from "./lib/presentation"

export interface AgentProviderPresentation {
  name: string
  model: string
  location: "local" | "remote"
}

export interface AgentTabPresentation {
  title: string
  url: string
}

export interface AgentViewProps {
  run?: AgentRunState | null
  steps?: AgentStepRecord[]
  provider?: AgentProviderPresentation
  tab?: AgentTabPresentation
  approval?: AgentApprovalRequest
  takeover?: AgentTakeoverRequest
  privacyAcknowledged?: boolean
  busy?: boolean
  /** The unsent goal. Held by the caller so it survives leaving the surface. */
  goal?: string
  onGoalChange?: (goal: string) => void
  onAcknowledgePrivacy?: () => void
  onStart?: (goal: string) => void
  onApprove?: () => void
  onReject?: () => void
  onPause?: () => void
  onResume?: () => void
  onStop?: () => void
  onTakeoverComplete?: () => void
  onFeedback?: () => void
}

const noop = () => undefined

export const AgentView = ({
  run = null,
  steps = [],
  provider,
  tab,
  approval,
  takeover,
  privacyAcknowledged = false,
  busy = false,
  goal = "",
  onGoalChange = () => undefined,
  onAcknowledgePrivacy = noop,
  onStart,
  onApprove = noop,
  onReject = noop,
  onPause = noop,
  onResume = noop,
  onStop = noop,
  onTakeoverComplete = noop,
  onFeedback = noop
}: AgentViewProps) => {
  const { t } = useTranslation()
  const settled =
    run !== null && ["completed", "failed", "cancelled"].includes(run.status)
  const remoteNeedsAcknowledgement =
    provider?.location === "remote" && !privacyAcknowledged
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
          </div>
          {run && (
            <span className="shrink-0 rounded-control bg-muted px-1.5 py-0.5 text-micro">
              {t("agent.observations", { count: run.observationCount })}
            </span>
          )}
        </header>

        <section className="mb-3 grid min-w-0 gap-1.5 rounded-panel border border-border/50 bg-background/70 p-2.5 text-xs">
          <div className="flex min-w-0 gap-2">
            <span className="shrink-0 text-muted-foreground">
              {t("agent.provider.label")}
            </span>
            <span className="min-w-0 flex-1 truncate text-right">
              {provider
                ? `${agentPlainText(provider.name, 100)} · ${t(`agent.provider.${provider.location}`)}`
                : t("agent.provider.missing")}
            </span>
          </div>
          <div className="flex min-w-0 gap-2">
            <span className="shrink-0 text-muted-foreground">
              {t("agent.model.label")}
            </span>
            <span className="min-w-0 flex-1 truncate text-right font-mono">
              {/* During a run the truth is the model that produced its steps,
                  not whatever is selected in Chat right now. */}
              {run?.modelId
                ? agentPlainText(run.modelId, 100)
                : provider
                  ? agentPlainText(provider.model, 100)
                  : t("agent.provider.missing")}
            </span>
          </div>
          <div className="flex min-w-0 gap-2">
            <span className="shrink-0 text-muted-foreground">
              {t("agent.tab.label")}
            </span>
            <span className="min-w-0 flex-1 truncate text-right">
              {tab
                ? agentPlainText(tab.title || tab.url, AGENT_PAGE_TEXT_LIMIT)
                : t("agent.tab.missing")}
            </span>
          </div>
        </section>

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
                <p>{t("agent.privacy.remote_notice")}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={onAcknowledgePrivacy}>
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
          <section className="mb-3 rounded-panel border border-status-warning/40 bg-status-warning/10 p-2.5 text-xs">
            <h2 className="font-medium">{t("agent.approval.title")}</h2>
            <p className="mt-1 break-words">
              {agentPlainText(approval.action, AGENT_PAGE_TEXT_LIMIT)}
            </p>
            <p className="mt-1 break-words text-muted-foreground">
              {agentPlainText(approval.consequence, AGENT_PAGE_TEXT_LIMIT)}
            </p>
            {approval.pageEvidence && (
              <p className="mt-1 max-h-12 overflow-hidden break-words rounded-control bg-background/70 px-2 py-1">
                {agentPlainText(approval.pageEvidence, AGENT_PAGE_TEXT_LIMIT)}
              </p>
            )}
            <div className="mt-2 flex gap-1.5">
              <Button type="button" onClick={onApprove}>
                {t("agent.approval.allow")}
              </Button>
              <Button type="button" variant="outline" onClick={onReject}>
                {t("agent.approval.reject")}
              </Button>
            </div>
          </section>
        )}

        {takeover && run?.status === "awaiting_takeover" && (
          <section className="mb-3 rounded-panel border border-app-primary/40 bg-app-primary-soft/40 p-2.5 text-xs">
            <h2 className="font-medium">{t("agent.takeover.title")}</h2>
            <p className="mt-1 break-words text-muted-foreground">
              {agentPlainText(takeover.instruction, AGENT_PAGE_TEXT_LIMIT)}
            </p>
          </section>
        )}

        {run?.pauseReason === "unresolved_effect" && (
          <section
            className="mb-3 flex gap-2 rounded-panel border border-destructive/30 bg-destructive/10 p-2.5 text-xs"
            role="alert">
            <MessageSquareWarning
              className="icon-sm shrink-0"
              aria-hidden="true"
            />
            <p>{t("agent.unresolved")}</p>
          </section>
        )}

        <AgentWorkLog items={toAgentWorkLog(steps)} />

        {settled && run && (
          <section className="mt-3 rounded-panel border border-border/50 bg-background p-2.5 text-xs">
            {run.result && (
              <p className="mb-2 whitespace-pre-wrap break-words">
                {agentPlainText(run.result, 20_000)}
              </p>
            )}
            {run.error && (
              <p className="mb-1 font-medium text-destructive">
                {agentPlainText(run.error.message, AGENT_PAGE_TEXT_LIMIT)}
              </p>
            )}
            <p>
              {t("agent.completion.summary", {
                count: run.observationCount,
                provider: agentPlainText(provider?.name ?? run.providerId, 100)
              })}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={onFeedback}>
              <ExternalLink className="icon-xs" aria-hidden="true" />
              {t("agent.feedback")}
            </Button>
          </section>
        )}
      </div>

      {run && !settled && (
        <AgentRunControls
          status={run.status}
          resumeDisabled={run.pauseReason === "unresolved_effect"}
          onPause={onPause}
          onResume={onResume}
          onStop={onStop}
          onTakeoverComplete={onTakeoverComplete}
        />
      )}
    </main>
  )
}
