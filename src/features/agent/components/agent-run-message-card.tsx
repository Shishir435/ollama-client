import { isTerminalAgentStatus } from "@ollama-client/agent-runtime"
import type { AgentFollowUpMode } from "@ollama-client/contracts"
import type { AgentRunCard } from "@ollama-client/contracts/agent-rpc"
import {
  Bot,
  MessageSquare,
  RotateCcw,
  SquarePen,
  StepForward
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/class-names"
import type { ChatMessage } from "@/types"
import { useAgentRunCard } from "../hooks/use-agent-run-card"
import { useAgentChatComposer } from "../lib/agent-chat-composer"
import {
  type AgentWorkspaceConnection,
  useAgentLiveRun
} from "../lib/agent-connection"
import { agentFailureMessageKey, agentPlainText } from "../lib/presentation"
import { AgentRunSupervision } from "./agent-run-supervision"

const AGENT_CARD_RESULT_LIMIT = 20_000

/**
 * Which follow-up a settled run offers. A run that got somewhere is carried
 * on from; one that stopped short is tried again. Either way the child plans
 * afresh and asks afresh, and cannot repeat what this one committed.
 */
const FOLLOW_UP_FOR: Partial<
  Record<AgentRunCard["status"], AgentFollowUpMode>
> = {
  completed: "continue",
  partial: "continue",
  failed: "retry",
  cancelled: "retry"
}

/** Statuses that wait on the user rather than on the run. */
const NEEDS_USER: readonly AgentRunCard["status"][] = [
  "awaiting_approval",
  "awaiting_takeover",
  "paused"
]

/**
 * What a settled run offers next. Every choice is a chat message drafted in
 * the composer, which the user still sends: Continue and Retry name this run
 * so the model carries it on, Start over restates its goal, Ask only moves
 * the caret. The model decides whether the browser is needed again, and a
 * run it starts asks for approval like any other.
 */
const AgentRunFollowUps = ({
  run,
  draft
}: {
  run: AgentRunCard
  draft: (text?: string, followUpRunId?: string) => void
}) => {
  const { t } = useTranslation()
  const followUp = FOLLOW_UP_FOR[run.status]

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {followUp && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            draft(t(`agent.follow_up.${followUp}_message`), run.id)
          }>
          {followUp === "continue" ? (
            <StepForward className="icon-xs" aria-hidden="true" />
          ) : (
            <RotateCcw className="icon-xs" aria-hidden="true" />
          )}
          {t(`agent.card.${followUp}`)}
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => draft(run.goal)}>
        <SquarePen className="icon-xs" aria-hidden="true" />
        {t("agent.card.start_over")}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => draft()}>
        <MessageSquare className="icon-xs" aria-hidden="true" />
        {t("agent.card.ask")}
      </Button>
    </div>
  )
}

/** The live run's supervision, wired to the panel's one port. */
const LiveRunSupervision = ({ live }: { live: AgentWorkspaceConnection }) => {
  const { connection, tab } = live
  const { snapshot, failure } = connection
  if (!snapshot.run) return null
  return (
    <AgentRunSupervision
      run={snapshot.run}
      steps={snapshot.steps}
      provider={snapshot.provider}
      tab={tab}
      approval={
        snapshot.pending?.kind === "approval"
          ? snapshot.pending.request
          : undefined
      }
      takeover={
        snapshot.pending?.kind === "takeover"
          ? snapshot.pending.request
          : undefined
      }
      failure={failure}
      onApprove={connection.approve}
      onReject={connection.reject}
      onAnswer={connection.answerQuestion}
      onPause={connection.pause}
      onResume={connection.resume}
      onCorrect={connection.correct}
      onStop={connection.stop}
      onTakeoverStart={connection.beginTakeover}
      onTakeoverComplete={connection.completeTakeover}
      onResolveEffect={connection.resolveEffect}
    />
  )
}

/**
 * The run a chat message reports, drawn in the conversation above the model's
 * own answer about it.
 *
 * A leaf: it reads the run by the id on its message and owns no chat state,
 * so a card that misbehaves can cost its own row and nothing around it. The
 * run the panel's port holds is supervised here — its approval, handover,
 * question and controls, each with its own control — because there is no
 * other surface to supervise it from. Any other run is read from its row.
 *
 * The answer below the card is the message's own text, drawn by chat. The
 * run's result is shown here only when that text is empty — a turn that
 * failed after the run settled, or a row written before runs were started
 * from a turn — so the same words never appear twice.
 */
export const AgentRunMessageCard = ({ msg }: { msg: ChatMessage }) => {
  const { t } = useTranslation()
  const state = useAgentRunCard(msg.agentRunId ?? "")
  const draft = useAgentChatComposer()
  const live = useAgentLiveRun(msg.agentRunId)

  const run = state.kind === "ready" ? state.run : undefined
  /** The port's word beats the row's: it is pushed, the row is polled. */
  const status = live?.connection.snapshot.run?.status ?? run?.status
  const settled = status ? isTerminalAgentStatus(status) : false
  const needsUser = status ? NEEDS_USER.includes(status) : false
  const supervised = live !== undefined && !settled
  const answered = msg.content.trim().length > 0

  return (
    <section
      aria-label={t("agent.card.title")}
      className={cn(
        "my-1 w-full max-w-[90vw] rounded-panel border p-2.5 text-xs sm:max-w-2xl",
        needsUser
          ? "border-status-warning/40 bg-tint-warning"
          : "border-border bg-surface-sunken"
      )}>
      <header className="flex min-w-0 items-center gap-1.5">
        <Bot className="icon-xs shrink-0" aria-hidden="true" />
        <span className="font-medium">{t("agent.card.title")}</span>
        {status && (
          <span
            className="ml-auto shrink-0 rounded-chip bg-background px-1.5 text-micro text-muted-foreground"
            aria-live={settled ? undefined : "polite"}>
            {t(`agent.status.${status}`)}
          </span>
        )}
      </header>

      {supervised && live && <LiveRunSupervision live={live} />}

      {!supervised && state.kind === "loading" && (
        <p className="mt-1.5 text-muted-foreground">
          {t("agent.card.loading")}
        </p>
      )}

      {state.kind === "missing" && !answered && (
        <p className="mt-1.5 text-muted-foreground">
          {t("agent.card.missing")}
        </p>
      )}

      {run && !supervised && (
        <>
          {run.result && !answered && (
            <p className="mt-1.5 wrap-break-word">
              {agentPlainText(run.result, AGENT_CARD_RESULT_LIMIT)}
            </p>
          )}
          {run.error && (
            <p className="mt-1.5 text-destructive">
              {t(agentFailureMessageKey(run.error))}
            </p>
          )}
          <p className="mt-1.5 text-micro text-muted-foreground">
            {t("agent.card.steps", { count: run.stepCount })}
            {run.outcome && run.outcome.total > 0 && (
              <>
                {" · "}
                {t("agent.card.outcome", {
                  met: run.outcome.met,
                  total: run.outcome.total
                })}
              </>
            )}
          </p>
          {settled && draft && <AgentRunFollowUps run={run} draft={draft} />}
        </>
      )}
    </section>
  )
}
