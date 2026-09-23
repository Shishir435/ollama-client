import type { AgentFollowUpMode } from "@ollama-client/contracts"
import { SendHorizontal, X } from "lucide-react"
import type { ReactNode } from "react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { TooltipActionButton } from "@/components/actions"
import { ComposerShell } from "@/components/layout/composer-shell"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/class-names"
import { agentPlainText } from "../lib/presentation"

/** The run the next Start follows, as the composer names it. */
export interface AgentComposerFollowUp {
  mode: AgentFollowUpMode
  parentGoal: string
}

/** Long enough to recognise the task, short enough to stay one line. */
const FOLLOW_UP_GOAL_LIMIT = 160

/**
 * Where a run is written, in the same shell the chat composer uses.
 *
 * The goal was a bare textarea in the scrolling body with a label above it and
 * its controls pinned somewhere else, so one panel read as two applications —
 * and the Start button scrolled away from the box it started. Here the goal,
 * the controls and the action are one surface at the bottom, which is where a
 * person already looks to say something.
 *
 * Mid-run there is no goal to write, so the controls stand alone: a bordered
 * box holding nothing but icons would be a composer pretending to accept
 * something it cannot.
 */
export const AgentGoalComposer = ({
  startable,
  goal,
  canStart,
  controls,
  onGoalChange,
  onStart,
  followUp,
  onClearFollowUp
}: {
  startable: boolean
  goal: string
  canStart: boolean
  /** The side panel's shared controls; absent where the panel lends none. */
  controls?: ReactNode
  onGoalChange: (goal: string) => void
  onStart: () => void
  followUp?: AgentComposerFollowUp
  onClearFollowUp?: () => void
}) => {
  const { t } = useTranslation()
  const [focused, setFocused] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)

  /*
   * Focused when the surface appears, the way the chat composer is. Switching
   * mounts this panel fresh, so a person who moved here to describe a task
   * would otherwise have to click the box they were already looking at.
   *
   * Mount only: a run that settles later brings the composer back while its
   * outcome is being read, and taking the caret at that moment would be the
   * panel interrupting rather than getting out of the way.
   */
  useEffect(() => {
    field.current?.focus()
  }, [])

  if (!startable) {
    if (!controls) return null
    return (
      /* Same pill the composer's row sits in, so the controls do not move
         or change shape when a run starts. */
      <div className="shrink-0 px-2 pb-2">
        <div className="flex min-w-0 items-center gap-0.5 rounded-control bg-surface-overlay p-1">
          {controls}
        </div>
      </div>
    )
  }

  return (
    <div className="shrink-0 px-2 pb-2">
      {/*
        Said above the box rather than folded into the goal: what the run
        follows is carried by the background from the parent's own rows, and
        the sentence below is only the instruction. Clearing it makes the
        next Start a fresh run.
      */}
      {followUp && (
        <div className="mb-1 flex min-w-0 items-center gap-1.5 rounded-control bg-surface-sunken px-2 py-1 text-micro text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            {t(`agent.follow_up.${followUp.mode}`, {
              goal: agentPlainText(followUp.parentGoal, FOLLOW_UP_GOAL_LIMIT)
            })}
          </span>
          {onClearFollowUp && (
            <button
              type="button"
              className="shrink-0 rounded-control p-0.5 hover:bg-state-hover hover:text-foreground"
              aria-label={t("agent.follow_up.clear")}
              onClick={onClearFollowUp}>
              <X className="icon-xs" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      <ComposerShell isFocused={focused}>
        <Textarea
          ref={field}
          id="agent-goal"
          aria-label={t("agent.start.goal")}
          value={goal}
          maxLength={20_000}
          placeholder={t(
            followUp?.mode === "continue"
              ? "agent.follow_up.placeholder"
              : "agent.start.placeholder"
          )}
          onChange={(event) => onGoalChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key !== "Enter" ||
              event.shiftKey ||
              event.nativeEvent.isComposing ||
              !canStart
            )
              return
            event.preventDefault()
            onStart()
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          /*
            The chat composer's own metrics. Its toolbar is absolutely placed
            over the foot of the field and the field reserves the space with
            `pb-14`, so the box is as tall as one text row plus the controls.
            Stacking the row underneath instead made this composer visibly
            taller than the one it sits beside on the other surface.
          */
          className={cn(
            "max-h-75 min-h-11 w-full resize-none border-0 bg-transparent",
            "pt-3 pr-14 pb-14 pl-4 text-sm leading-relaxed scrollbar-none",
            "focus-visible:ring-0 focus-visible:ring-offset-0",
            "placeholder:text-foreground-tertiary"
          )}
        />
        {/*
          The same send control the chat composer has, in the same corner: one
          icon at the top-right of the field rather than a worded button down
          in the control row, so both surfaces are dispatched the same way.
        */}
        <div className="absolute top-3 right-3">
          <TooltipActionButton
            onClick={onStart}
            variant="ghost"
            size="icon"
            className="rounded-control"
            disabled={!canStart}
            label={t("agent.start.action")}
            icon={<SendHorizontal size={16} />}
          />
        </div>
        <div className="absolute right-1 bottom-1 left-1 flex min-w-0 items-center gap-0.5 rounded-control bg-surface-overlay p-1 backdrop-blur">
          {controls}
        </div>
      </ComposerShell>
    </div>
  )
}
