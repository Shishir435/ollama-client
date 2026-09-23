import { isTerminalAgentStatus } from "@ollama-client/agent-runtime"
import type { AgentFollowUpMode } from "@ollama-client/contracts"
import type { AgentRunCard } from "@ollama-client/contracts/agent-rpc"
import {
  Bot,
  ExternalLink,
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
import {
  useAgentChatComposer,
  useAgentSurfaceLauncher
} from "../lib/agent-surface-launcher"
import { agentFailureMessageKey, agentPlainText } from "../lib/presentation"
import { agentDraftStore } from "../stores/agent-draft-store"

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
 * What a settled run offers next. Asking stays in chat; new browser work is
 * only ever one of these buttons, and each lands on the Agent composer.
 */
const AgentRunFollowUps = ({
  run,
  openAgent,
  askInChat
}: {
  run: AgentRunCard
  openAgent?: () => void
  askInChat?: () => void
}) => {
  const { t } = useTranslation()
  if (!openAgent && !askInChat) return null
  const followUp = FOLLOW_UP_FOR[run.status]

  const draftFrom = (mode?: AgentFollowUpMode) => {
    if (!openAgent) return
    agentDraftStore
      .getState()
      .beginDraft(
        mode === "continue" ? "" : run.goal,
        run.id,
        mode ? { parentRunId: run.id, mode, parentGoal: run.goal } : undefined
      )
    openAgent()
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {followUp && openAgent && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => draftFrom(followUp)}>
          {followUp === "continue" ? (
            <StepForward className="icon-xs" aria-hidden="true" />
          ) : (
            <RotateCcw className="icon-xs" aria-hidden="true" />
          )}
          {t(`agent.card.${followUp}`)}
        </Button>
      )}
      {openAgent && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => draftFrom()}>
          <SquarePen className="icon-xs" aria-hidden="true" />
          {t("agent.card.start_over")}
        </Button>
      )}
      {askInChat && (
        <Button type="button" size="sm" variant="ghost" onClick={askInChat}>
          <MessageSquare className="icon-xs" aria-hidden="true" />
          {t("agent.card.ask")}
        </Button>
      )}
    </div>
  )
}

/**
 * The run a chat message reports, drawn in the conversation.
 *
 * A leaf: it reads the run by the id on its message and owns no chat state,
 * so a card that misbehaves can cost its own row and nothing around it. The
 * supervision controls stay on the Agent surface — a card offers the way
 * there, never a second set of buttons that could disagree with the first.
 *
 * When the run is gone the message's own text is shown instead. That is what
 * the terminal commit wrote there for any reader that does not know about
 * runs, and after a prune or a restore without the run it is all there is.
 *
 * A settled run is where the conversation decides what happens next, so the
 * choice is made here and made explicitly. Asking about it stays in chat and
 * never touches a browser: the turn reads the run's handoff and nothing else.
 * New browser work is only ever a button — Continue or Retry follow this
 * run, Start over sets its goal as a fresh one — and each lands on the Agent
 * composer, where the user still presses Start.
 */
export const AgentRunMessageCard = ({ msg }: { msg: ChatMessage }) => {
  const { t } = useTranslation()
  const state = useAgentRunCard(msg.agentRunId ?? "")
  const openAgent = useAgentSurfaceLauncher()
  const askInChat = useAgentChatComposer()

  const run = state.kind === "ready" ? state.run : undefined
  const settled = run ? isTerminalAgentStatus(run.status) : false
  const needsUser = run ? NEEDS_USER.includes(run.status) : false
  const fallback = msg.content.trim()

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
        {run && (
          <span
            className="ml-auto shrink-0 rounded-chip bg-background px-1.5 text-micro text-muted-foreground"
            aria-live={settled ? undefined : "polite"}>
            {t(`agent.status.${run.status}`)}
          </span>
        )}
      </header>

      {state.kind === "loading" && (
        <p className="mt-1.5 text-muted-foreground">
          {t("agent.card.loading")}
        </p>
      )}

      {state.kind === "missing" && (
        <p
          className={cn(
            "mt-1.5 wrap-break-word",
            !fallback && "text-muted-foreground"
          )}>
          {fallback
            ? agentPlainText(fallback, AGENT_CARD_RESULT_LIMIT)
            : t("agent.card.missing")}
        </p>
      )}

      {run && (
        <>
          {run.result && (
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
          {!settled && openAgent && (
            <Button
              type="button"
              size="sm"
              variant={needsUser ? "default" : "outline"}
              className="mt-2"
              onClick={openAgent}>
              <ExternalLink className="icon-xs" aria-hidden="true" />
              {needsUser ? t("agent.card.needs_you") : t("agent.card.open")}
            </Button>
          )}
          {settled && (
            <AgentRunFollowUps
              run={run}
              openAgent={openAgent}
              askInChat={askInChat}
            />
          )}
        </>
      )}
    </section>
  )
}
