import type { AgentBrowserDisclosure } from "@ollama-client/contracts"
import { Eye, LoaderCircle, X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import type { AgentCommandFailure } from "../hooks/use-agent-run"
import {
  type AgentProviderPresentation,
  type AgentTabPresentation,
  agentPlainText,
  agentScreenshotsMayTravel
} from "../lib/presentation"
import type { AgentDraftFollowUp } from "../stores/agent-draft-store"
import { AgentBrowserDisclosureCard } from "./agent-browser-disclosure-card"
import { AgentModelReadinessCard } from "./agent-model-readiness-card"
import { AgentRunDetailsCard } from "./agent-run-details-card"

/** Long enough to recognise the task, short enough to stay one line. */
const FOLLOW_UP_GOAL_LIMIT = 160

const remoteNoticeKey = (provider?: AgentProviderPresentation): string =>
  agentScreenshotsMayTravel(provider)
    ? "agent.privacy.remote_notice_screenshots"
    : "agent.privacy.remote_notice"

export interface AgentActPreflightProps {
  provider?: AgentProviderPresentation
  browser?: AgentBrowserDisclosure
  tab?: AgentTabPresentation
  failure?: AgentCommandFailure
  followUp?: AgentDraftFollowUp
  onClearFollowUp: () => void
  /** A run already holds the browser; a second cannot start beside it. */
  runInProgress: boolean
  /**
   * A start left the panel and nothing has answered it yet. Attaching to a
   * tab and resolving the model can take seconds, and a cleared box with no
   * sign of work reads as a Start that was dropped.
   */
  starting?: boolean
  showRemoteNotice: boolean
  onAcknowledgePrivacy: (scope: "observations" | "screenshots") => void
  allowRoutineActions: boolean
  onAllowRoutineActions: (allowed: boolean) => void
  allowExperimentalModel: boolean
  onAllowExperimentalModel: (allowed: boolean) => void
}

/**
 * What a task would be, shown above the composer while it is sending one.
 *
 * Everything the Agent surface asked before Start, now asked where Start is:
 * which model and whether it can drive a page, what this browser lets a run
 * do, which tab it would take, the one-time notice for a remote model, and
 * the routine-actions consent. Grouped because they answer one question —
 * whether to start — and they come and go with the mode.
 *
 * Scrolls on its own, and stays short: the conversation above is still the
 * thing on screen, and a preflight that pushed it away would make Act mode a
 * second surface wearing the chat's clothes.
 */
export const AgentActPreflight = ({
  provider,
  browser,
  tab,
  failure,
  followUp,
  onClearFollowUp,
  runInProgress,
  starting = false,
  showRemoteNotice,
  onAcknowledgePrivacy,
  allowRoutineActions,
  onAllowRoutineActions,
  allowExperimentalModel,
  onAllowExperimentalModel
}: AgentActPreflightProps) => {
  const { t } = useTranslation()

  return (
    <section
      aria-label={t("agent.title")}
      className="mb-2 max-h-72 space-y-2 overflow-y-auto text-xs">
      {failure && (
        <div
          role="alert"
          className="rounded-panel border border-destructive/30 bg-tint-danger px-2.5 py-2">
          <p>{t(failure.messageKey)}</p>
          {failure.detail && (
            <p className="mt-1 wrap-break-word font-mono text-micro text-muted-foreground">
              {agentPlainText(failure.detail, 300)}
            </p>
          )}
        </div>
      )}

      {starting && !runInProgress && (
        <p
          role="status"
          className="flex items-center gap-1.5 rounded-panel border border-border bg-surface-sunken px-2.5 py-2">
          <LoaderCircle
            className="icon-xs shrink-0 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          <span className="min-w-0 truncate">
            {tab?.title
              ? t("agent.start.starting_on", { title: tab.title })
              : t("agent.start.starting")}
          </span>
        </p>
      )}

      {runInProgress && (
        <p className="rounded-panel border border-border bg-surface-sunken px-2.5 py-2 text-muted-foreground">
          {t("agent.composer.run_in_progress")}
        </p>
      )}

      {/*
        Said above the box rather than folded into the goal: what the run
        follows is carried by the background from the parent's own rows, and
        the sentence below is only the instruction. Clearing it makes the
        next Start a fresh run.
      */}
      {followUp && (
        <div className="flex min-w-0 items-center gap-1.5 rounded-control bg-surface-sunken px-2 py-1 text-micro text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            {t(`agent.follow_up.${followUp.mode}`, {
              goal: agentPlainText(followUp.parentGoal, FOLLOW_UP_GOAL_LIMIT)
            })}
          </span>
          <button
            type="button"
            className="shrink-0 rounded-control p-0.5 hover:bg-state-hover hover:text-foreground"
            aria-label={t("agent.follow_up.clear")}
            onClick={onClearFollowUp}>
            <X className="icon-xs" aria-hidden="true" />
          </button>
        </div>
      )}

      {provider?.readiness && (
        <AgentModelReadinessCard
          readiness={provider.readiness}
          allowExperimental={allowExperimentalModel}
          onAllowExperimental={onAllowExperimentalModel}
        />
      )}
      {browser && <AgentBrowserDisclosureCard browser={browser} />}
      <AgentRunDetailsCard provider={provider} tab={tab} />

      <label className="flex items-start gap-2 rounded-panel border border-border p-2.5">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={allowRoutineActions}
          onChange={(event) => onAllowRoutineActions(event.target.checked)}
        />
        <span>
          <span className="font-medium">{t("agent.start.auto_actions")}</span>
          <span className="mt-1 block text-muted-foreground">
            {t("agent.start.auto_actions_description")}
          </span>
        </span>
      </label>

      {showRemoteNotice && (
        <div className="rounded-panel border border-status-warning/40 bg-tint-warning p-2.5">
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
  )
}
