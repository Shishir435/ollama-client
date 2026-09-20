import { type ReactNode, useEffect } from "react"
import { useTranslation } from "react-i18next"

import { SettingsButton } from "@/components/settings-button"
import { ModelMenu } from "@/features/model/components/model-menu"
import { ReasoningEffortMenu } from "@/features/model/components/reasoning-effort-menu"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"
import { useSetting } from "@/hooks/use-setting"
import { openOptionsInTab, runtime } from "@/lib/browser-api"
import { downloadFile } from "@/lib/exporters/utils"
import { SETTINGS } from "@/lib/storage/settings"
import { AgentView } from "./agent-view"
import { useAgentCandidateTab } from "./hooks/use-agent-candidate-tab"
import { useAgentDebugReport } from "./hooks/use-agent-debug-report"
import { useAgentRun } from "./hooks/use-agent-run"
import { agentPlainText, visibleAgentTab } from "./lib/presentation"
import { useAgentDraft } from "./stores/agent-draft-store"

/**
 * The Agent surface as the side panel mounts it: the supervision port, the
 * selected model, and the one-time remote-observation acknowledgement wired to
 * the presentational view.
 *
 * Run state is never held here. Every control posts a command and the next
 * snapshot is the answer, so what the panel shows always describes the durable
 * run rather than an optimistic guess about it.
 */
export const AgentPanel = ({ leading }: { leading?: ReactNode } = {}) => {
  const { t } = useTranslation()
  const { selectedModel, selectedProviderId } = useProviderModels()
  const [acknowledged, setAcknowledged] = useSetting(
    SETTINGS.AGENT_REMOTE_OBSERVATION_ACKNOWLEDGED
  )
  const [screenshotsAcknowledged, setScreenshotsAcknowledged] = useSetting(
    SETTINGS.AGENT_REMOTE_SCREENSHOT_ACKNOWLEDGED
  )
  const { goal, setGoal, completeGoal } = useAgentDraft()
  const candidateTab = useAgentCandidateTab()
  const connection = useAgentRun({
    providerId: selectedProviderId || undefined,
    modelId: selectedModel || undefined,
    tabId: candidateTab?.id
  })
  useAgentDebugReport(connection.debugReport)
  const { snapshot } = connection

  useEffect(() => {
    const run = snapshot.run
    if (run?.status === "completed") completeGoal(run.id, run.goal)
  }, [completeGoal, snapshot.run])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {connection.failure && (
        <div
          role="alert"
          className="shrink-0 border-b border-destructive/30 bg-tint-danger px-3 py-2 text-xs">
          <p>{t(connection.failure.messageKey)}</p>
          {connection.failure.detail && (
            <p className="mt-1 wrap-break-word font-mono text-micro text-muted-foreground">
              {agentPlainText(connection.failure.detail, 300)}
            </p>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <AgentView
          leading={
            leading && (
              <>
                {/*
                 * The model a run will use, changeable from the surface that
                 * runs it. The panel stated it read-only, so picking another
                 * one meant switching to chat, changing it there, and coming
                 * back — for the setting this surface cares most about.
                 */}
                <ModelMenu
                  showStatusPopup={false}
                  tooltipTextContent={t("chat.input.switch_model")}
                />
                {/*
                 * Reasoning effort is a per-model setting the chat composer
                 * has always offered and this surface never did, so the one
                 * place it matters most — a run that plans twenty-five steps
                 * — was the one place it could not be set.
                 */}
                <ReasoningEffortMenu />
                <SettingsButton
                  showText={false}
                  variant="ghost"
                  size="icon"
                  className="shrink-0 rounded-control text-muted-foreground hover:bg-state-hover hover:text-foreground"
                  iconClassName="icon-sm"
                />
                {/*
                 * Last in the row, beside the effort control: the two panel
                 * controls sit together at the end, the way the chat composer
                 * keeps its toggle next to settings, rather than the switch
                 * leading a row of run controls.
                 */}
                {leading}
              </>
            )
          }
          run={snapshot.run ?? null}
          steps={snapshot.steps}
          browser={snapshot.browser}
          provider={snapshot.provider}
          tab={visibleAgentTab(snapshot.run, snapshot.tab, candidateTab)}
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
          privacyAcknowledged={acknowledged === true}
          screenshotsAcknowledged={screenshotsAcknowledged === true}
          busy={connection.busy}
          goal={goal}
          onGoalChange={setGoal}
          onAcknowledgePrivacy={(scope) => {
            void setAcknowledged(true)
            if (scope === "screenshots") void setScreenshotsAcknowledged(true)
          }}
          onStart={connection.start}
          onAnswer={connection.answerQuestion}
          onApprove={connection.approve}
          onReject={connection.reject}
          onPause={connection.pause}
          onResume={connection.resume}
          onCorrect={connection.correct}
          onStop={connection.stop}
          onTakeoverComplete={connection.completeTakeover}
          onResolveEffect={connection.resolveEffect}
          onExport={() => {
            if (!snapshot.run) return
            downloadFile(
              new Blob(
                [
                  JSON.stringify(
                    { run: snapshot.run, steps: snapshot.steps },
                    null,
                    2
                  )
                ],
                { type: "application/json" }
              ),
              `agent-${snapshot.run.id}.json`
            )
          }}
          onFeedback={() =>
            void openOptionsInTab(runtime.getURL("options.html?tab=privacy"))
          }
        />
      </div>
    </div>
  )
}
