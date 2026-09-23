import { type ReactNode, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { SettingsButton } from "@/components/settings-button"
import { ModelMenu } from "@/features/model/components/model-menu"
import { ReasoningEffortMenu } from "@/features/model/components/reasoning-effort-menu"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
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
  /*
   * The chat a run belongs to. Read here rather than resolved in the
   * background: the panel is the surface the user started from, and which
   * conversation they were looking at is not something a worker can infer
   * later.
   */
  const currentSessionId = useChatSessions().currentSessionId
  const {
    goal,
    followUp,
    setGoal,
    completeGoal,
    clearFollowUp,
    settleFollowUp
  } = useAgentDraft()
  const candidateTab = useAgentCandidateTab()
  /*
   * Deliberately not durable, and scoped to the pair it was given for. This is
   * a confirmation that the user meant to run on a model whose tool calling is
   * their own override rather than the model's answer, so it cannot outlive
   * the model it was about: the panel stays mounted across a model switch, and
   * a yes carried over would start the next experimental model without anyone
   * confirming that one.
   */
  const [experimentalModelRef, setExperimentalModelRef] = useState<
    string | undefined
  >(undefined)
  const selectedModelRef =
    selectedProviderId && selectedModel
      ? `${selectedProviderId}\u0000${selectedModel}`
      : undefined
  const allowExperimentalModel =
    selectedModelRef !== undefined && experimentalModelRef === selectedModelRef
  const connection = useAgentRun({
    providerId: selectedProviderId || undefined,
    modelId: selectedModel || undefined,
    tabId: candidateTab?.id,
    ...(currentSessionId ? { sessionId: currentSessionId } : {}),
    allowExperimentalModel
  })
  useAgentDebugReport(connection.debugReport)
  const { snapshot } = connection

  useEffect(() => {
    const run = snapshot.run
    if (run?.status === "completed") completeGoal(run.id, run.goal)
  }, [completeGoal, snapshot.run])

  /** The run the displayed one follows, which is what spends a draft's. */
  const followedRunId = snapshot.run?.previousRun?.handoff.runId
  useEffect(() => {
    settleFollowUp(followedRunId)
  }, [settleFollowUp, followedRunId])

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
          allowExperimentalModel={allowExperimentalModel}
          onAllowExperimentalModel={(allowed) =>
            setExperimentalModelRef(allowed ? selectedModelRef : undefined)
          }
          busy={connection.busy}
          goal={goal}
          onGoalChange={setGoal}
          followUp={followUp}
          onClearFollowUp={clearFollowUp}
          onAcknowledgePrivacy={(scope) => {
            void setAcknowledged(true)
            if (scope === "screenshots") void setScreenshotsAcknowledged(true)
          }}
          onStart={(text, allowRoutineActions) =>
            connection.start(
              text,
              allowRoutineActions,
              followUp && {
                parentRunId: followUp.parentRunId,
                mode: followUp.mode
              }
            )
          }
          onAnswer={connection.answerQuestion}
          onApprove={connection.approve}
          onReject={connection.reject}
          onPause={connection.pause}
          onResume={connection.resume}
          onCorrect={connection.correct}
          onStop={connection.stop}
          onTakeoverStart={connection.beginTakeover}
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
