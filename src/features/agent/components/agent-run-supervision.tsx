import {
  type AgentApprovalRequest,
  type AgentRunState,
  type AgentStepRecord,
  type AgentTakeoverRequest,
  MAX_AGENT_OBSERVATIONS
} from "@ollama-client/contracts"
import { CircleAlert, Info, MessageSquareWarning } from "lucide-react"
import { useLayoutEffect, useRef } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/class-names"
import type { AgentCommandFailure } from "../hooks/use-agent-run"
import { agentDisplayString } from "../lib/display-text"
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
  /**
   * A command this run refused — an approval that arrived too late, a pause
   * the worker never got. Shown on the run, because the composer that used
   * to show it is back in Chat by the time a run is being supervised.
   */
  failure?: AgentCommandFailure
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

/**
 * Why a paused run is paused, when nothing else on the card already says it.
 * A question and a user pause each have their own answer box, and a takeover
 * has its own card; every other reason gets a sentence, or the card reads
 * "Paused" with no way to tell whether the run is waiting on the user.
 */
const pauseNoticeFor = (reason?: AgentRunState["pauseReason"]) => {
  if (reason === "unresolved_effect") {
    return {
      messageKey: "agent.unresolved",
      tone: "danger" as const
    }
  }
  if (reason === "browser_disconnected") {
    return {
      messageKey: "agent.browser_disconnected",
      tone: "warning" as const
    }
  }
  if (reason === "panel_closed") {
    return {
      messageKey: "agent.paused_panel_closed",
      tone: "info" as const
    }
  }
  return undefined
}

const NOTICE_TONE = {
  danger: "border-destructive/30 bg-tint-danger",
  warning: "border-status-warning/40 bg-tint-warning",
  info: "border-border bg-surface-sunken"
} as const

/** Pixels from the bottom that still count as reading the latest step. */
const FOLLOW_SLACK_PX = 24

/**
 * Keeps a bounded log scrolled to its newest row while the reader is there,
 * and leaves it alone once they scroll up to read an earlier one — a log
 * that yanked them back on every step would be unreadable during a run.
 */
const useFollowLatest = (rows: number) => {
  const ref = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  useLayoutEffect(() => {
    const box = ref.current
    if (!box || !following.current || rows === 0) return
    box.scrollTop = box.scrollHeight
  }, [rows])
  const onScroll = () => {
    const box = ref.current
    if (!box) return
    following.current =
      box.scrollHeight - box.scrollTop - box.clientHeight <= FOLLOW_SLACK_PX
  }
  return { ref, onScroll }
}

/**
 * How far into its budget a run is. The count says one of fifty; the bar
 * says what that looks like, and whether the run is early or about to be cut
 * off is arithmetic a shape does for free.
 */
/** Enough of a raw error to recognise it, not enough to become the card. */
const AGENT_FAILURE_DETAIL_LIMIT = 300

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
  failure,
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
  const workLog = toAgentWorkLog(steps)
  const log = useFollowLatest(workLog.length)

  return (
    <div className="mt-1.5">
      {currentAction && (
        <p className="truncate font-medium">
          {t(currentAction.key, currentAction.values)}
        </p>
      )}
      <p className="text-micro text-muted-foreground">
        {t("agent.progress", {
          count: run.observationCount,
          budget: MAX_AGENT_OBSERVATIONS
        })}
      </p>
      <AgentProgressBar used={run.observationCount} />

      {/**
       * Above everything that grows. Pause and Stop were the last row of a
       * scrolled log, so on a long run the way to stop it was scrolled out of
       * sight at the moment it was wanted; here they never move.
       */}
      <AgentRunControls
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

      <div className="mt-2">
        {failure && (
          <section
            className="mb-3 flex gap-2 rounded-panel border border-destructive/30 bg-tint-danger p-2.5"
            role="alert">
            <CircleAlert className="icon-sm shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p>{t(failure.messageKey)}</p>
              {failure.detail && (
                <p className="mt-1 wrap-break-word font-mono text-micro text-muted-foreground">
                  {agentPlainText(failure.detail, AGENT_FAILURE_DETAIL_LIMIT)}
                </p>
              )}
            </div>
          </section>
        )}

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
          <AgentQuestionCard
            onAnswer={onAnswer}
            question={agentDisplayString(
              t,
              run.question.display,
              run.question.text,
              AGENT_PAGE_TEXT_LIMIT
            )}
          />
        )}

        {takeover && run.status === "awaiting_takeover" && (
          <section
            className="mb-3 rounded-panel border border-app-primary/40 bg-app-primary-soft/40 p-2.5"
            role="alert">
            <h2 className="font-medium">{t("agent.takeover.title")}</h2>
            <p className="mt-1 wrap-break-word text-muted-foreground">
              {agentDisplayString(
                t,
                takeover.display,
                takeover.instruction,
                AGENT_PAGE_TEXT_LIMIT
              )}
            </p>
          </section>
        )}

        {pauseNotice && run.status === "paused" && (
          <section
            className={cn(
              "mb-3 rounded-panel border p-2.5",
              NOTICE_TONE[pauseNotice.tone]
            )}
            role={pauseNotice.tone === "info" ? "status" : "alert"}>
            <div className="flex gap-2">
              {pauseNotice.tone === "info" ? (
                <Info className="icon-sm shrink-0" aria-hidden="true" />
              ) : (
                <MessageSquareWarning
                  className="icon-sm shrink-0"
                  aria-hidden="true"
                />
              )}
              <p>{t(pauseNotice.messageKey)}</p>
            </div>
            {/**
             * The way out of an unresolved effect. Nothing is replayed: the
             * run looks at the page again and decides from what is there.
             * Without it the only exit was to stop and start the whole goal
             * over, which is what actually risked repeating the action.
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
      </div>

      <AgentRunDetailsCard
        provider={provider}
        run={run}
        tab={tab}
        pinnedModel
      />

      {/**
       * Bounded: the log is a card in a conversation, and a fifty-step run
       * must not push the rest of the chat off the screen.
       */}
      <div
        ref={log.ref}
        onScroll={log.onScroll}
        className="max-h-64 overflow-y-auto overscroll-contain">
        <AgentWorkLog
          items={workLog}
          live={currentAction ? undefined : t(`agent.status.${run.status}`)}
          liveAt={run.updatedAt}
        />
      </div>
    </div>
  )
}
