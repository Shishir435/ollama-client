import {
  type AgentApprovalRequest,
  type AgentRunState,
  type AgentStepRecord,
  type AgentTakeoverRequest,
  MAX_AGENT_OBSERVATIONS
} from "@ollama-client/contracts"
import { MessageSquareWarning } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  AGENT_PAGE_TEXT_LIMIT,
  type AgentProviderPresentation,
  type AgentTabPresentation,
  agentPlainText,
  currentAgentAction,
  toAgentWorkLog
} from "../lib/presentation"
import { AgentApprovalCard } from "./agent-approval-card"
import { AgentQuestionCard } from "./agent-question-card"
import { AgentRunControls } from "./agent-run-controls"
import { AgentRunDetailsCard } from "./agent-run-details-card"
import { AgentWorkLog } from "./agent-work-log"

export interface AgentRunSupervisionProps {
  run: AgentRunState
  steps: AgentStepRecord[]
  provider?: AgentProviderPresentation
  tab?: AgentTabPresentation
  approval?: AgentApprovalRequest
  takeover?: AgentTakeoverRequest
  onApprove: (scope?: "run_origin") => void
  onReject: () => void
  onAnswer: (text: string) => void
  onPause: () => void
  onResume: () => void
  onCorrect: (text: string) => void
  onStop: () => void
  onTakeoverStart: () => void
  onTakeoverComplete: () => void
  onResolveEffect: () => void
}

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
 * How far into its budget a run is. The count says one of fifty; the bar
 * says what that looks like, and whether the run is early or about to be cut
 * off is arithmetic a shape does for free.
 */
const AgentProgressBar = ({ used }: { used: number }) => (
  <div
    className="my-2 h-1 overflow-hidden rounded-full bg-muted"
    aria-hidden="true">
    <div
      className="h-full rounded-full bg-app-agent transition-[width] duration-500"
      style={{
        width: `${Math.min(100, Math.round((used / MAX_AGENT_OBSERVATIONS) * 100))}%`
      }}
    />
  </div>
)

/**
 * A live run, supervised from the message that reports it.
 *
 * Everything the Agent surface offered while a run was working, in the
 * conversation that asked for it: what it is doing now, the approval or
 * handover it is waiting on, the question it asked, the controls that pause
 * or stop it, and the log of what it has done. Each decision has its own
 * control here. The composer below never carries one: a reply typed there is
 * a chat message, and an approval implied by one would be a yes the user did
 * not give.
 */
export const AgentRunSupervision = ({
  run,
  steps,
  provider,
  tab,
  approval,
  takeover,
  onApprove,
  onReject,
  onAnswer,
  onPause,
  onResume,
  onCorrect,
  onStop,
  onTakeoverStart,
  onTakeoverComplete,
  onResolveEffect
}: AgentRunSupervisionProps) => {
  const { t } = useTranslation()
  const currentAction = currentAgentAction(steps)
  const pauseNotice = pauseNoticeFor(run.pauseReason)

  return (
    <div className="mt-1.5">
      {currentAction && (
        <p className="truncate">{t(currentAction.key, currentAction.values)}</p>
      )}
      <p className="text-micro text-muted-foreground">
        {t("agent.progress", {
          count: run.observationCount,
          budget: MAX_AGENT_OBSERVATIONS
        })}
      </p>
      <AgentProgressBar used={run.observationCount} />

      <AgentRunDetailsCard
        provider={provider}
        run={run}
        tab={tab}
        pinnedModel
      />

      {approval && run.status === "awaiting_approval" && (
        <AgentApprovalCard
          onApprove={onApprove}
          onReject={onReject}
          request={approval}
        />
      )}

      {run.status === "paused" && run.pauseReason === "user" && (
        <AgentQuestionCard
          question={t("agent.correction")}
          onAnswer={onCorrect}
        />
      )}

      {run.question && run.status === "paused" && (
        <AgentQuestionCard onAnswer={onAnswer} question={run.question.text} />
      )}

      {takeover && run.status === "awaiting_takeover" && (
        <section className="mb-3 rounded-panel border border-app-primary/40 bg-app-primary-soft/40 p-2.5">
          <h2 className="font-medium">{t("agent.takeover.title")}</h2>
          <p className="mt-1 wrap-break-word text-muted-foreground">
            {agentPlainText(takeover.instruction, AGENT_PAGE_TEXT_LIMIT)}
          </p>
        </section>
      )}

      {pauseNotice && (
        <section
          className={`mb-3 rounded-panel border p-2.5 ${pauseNotice.className}`}
          role="alert">
          <div className="flex gap-2">
            <MessageSquareWarning
              className="icon-sm shrink-0"
              aria-hidden="true"
            />
            <p>{t(pauseNotice.messageKey)}</p>
          </div>
          {/**
           * The way out of an unresolved effect. Nothing is replayed: the run
           * looks at the page again and decides from what is there. Without
           * it the only exit was to stop and start the whole goal over, which
           * is what actually risked repeating the action.
           */}
          {run.pauseReason === "unresolved_effect" && (
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

      {/*
        Bounded: the log is a card in a conversation, and a fifty-step run
        must not push the rest of the chat off the screen.
      */}
      <div className="max-h-64 overflow-y-auto">
        <AgentWorkLog
          items={toAgentWorkLog(steps)}
          live={currentAction ? undefined : t(`agent.status.${run.status}`)}
          liveAt={run.updatedAt}
          controls={
            <AgentRunControls
              inline
              status={run.status}
              resumeDisabled={
                run.pauseReason === "unresolved_effect" ||
                run.pauseReason === "question"
              }
              takeoverStarted={run.status === "awaiting_takeover" && !takeover}
              onPause={onPause}
              onResume={onResume}
              onStop={onStop}
              onTakeoverStart={onTakeoverStart}
              onTakeoverComplete={onTakeoverComplete}
            />
          }
        />
      </div>
    </div>
  )
}
