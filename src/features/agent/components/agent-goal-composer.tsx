import type { ReactNode } from "react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { ComposerShell } from "@/components/layout/composer-shell"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

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
  onStart
}: {
  startable: boolean
  goal: string
  canStart: boolean
  /** The side panel's shared controls; absent where the panel lends none. */
  controls?: ReactNode
  onGoalChange: (goal: string) => void
  onStart: () => void
}) => {
  const { t } = useTranslation()
  const [focused, setFocused] = useState(false)

  if (!startable) {
    if (!controls) return null
    return (
      <div className="shrink-0 px-2 pb-2">
        <div className="flex min-w-0 items-center gap-0.5">{controls}</div>
      </div>
    )
  }

  return (
    <div className="shrink-0 px-2 pb-2">
      <ComposerShell isFocused={focused}>
        <Textarea
          id="agent-goal"
          value={goal}
          maxLength={20_000}
          placeholder={t("agent.start.placeholder")}
          onChange={(event) => onGoalChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="min-h-16 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <div className="flex min-w-0 items-center gap-0.5 p-1">
          {controls}
          <Button
            type="button"
            size="sm"
            className="ml-auto shrink-0"
            disabled={!canStart}
            onClick={onStart}>
            {t("agent.start.action")}
          </Button>
        </div>
      </ComposerShell>
    </div>
  )
}
