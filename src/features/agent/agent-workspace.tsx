import { isTerminalAgentStatus } from "@ollama-client/agent-runtime"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { agentReadinessPermitsStart } from "@/application/agent/agent-model-readiness"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { useSetting } from "@/hooks/use-setting"
import { SETTINGS } from "@/lib/storage/settings"
import { AgentActPreflight } from "./components/agent-act-preflight"
import { AgentModeToggle } from "./components/agent-mode-toggle"
import { useAgentCandidateTab } from "./hooks/use-agent-candidate-tab"
import { useAgentDebugReport } from "./hooks/use-agent-debug-report"
import { useAgentRun } from "./hooks/use-agent-run"
import { AgentConnectionContext } from "./lib/agent-connection"
import {
  agentNeedsRemoteAcknowledgement,
  visibleAgentTab
} from "./lib/presentation"
import { type AgentShownRun, useAgentDraft } from "./stores/agent-draft-store"

/**
 * The Agent's way of using the chat composer, in the shape the composer
 * accepts. Declared here rather than imported, because the Agent may not
 * import chat; the shell hands this to the composer, and the two shapes
 * agree structurally or the shell does not compile.
 */
export interface AgentComposerMode {
  active: boolean
  inputLabel: string
  placeholder: string
  submitLabel: string
  preflight?: ReactNode
  canSubmit: (text: string) => boolean
  submit: (text: string) => void
  prefill?: { text: string; token: number }
}

export interface AgentWorkspaceSlots {
  /** The Chat/Act switch, for the composer's control row. */
  toggle: ReactNode
  mode: AgentComposerMode
}

/**
 * The Agent inside the chat workspace: one supervision port for the life of
 * the panel, and the composer mode that starts a task from the chat box.
 *
 * There is no Agent surface any more. A run is started from the composer in
 * Act mode, reported and supervised by its card in the conversation, and
 * followed up from that card — so the port that used to live and die with a
 * surface lives with the panel. Leaving a surface paused the run; chatting
 * while it works now does not.
 *
 * Render-prop, not context, for the chat side: the composer's slot belongs
 * to chat, which this module may not import, so the shell takes these slots
 * and provides them itself.
 */
export const AgentWorkspace = ({
  children
}: {
  children: (slots: AgentWorkspaceSlots) => ReactNode
}) => {
  const { t } = useTranslation()
  const { selectedModel, selectedProviderId } = useProviderModels()
  const [acknowledged, setAcknowledged] = useSetting(
    SETTINGS.AGENT_REMOTE_OBSERVATION_ACKNOWLEDGED
  )
  const [screenshotsAcknowledged, setScreenshotsAcknowledged] = useSetting(
    SETTINGS.AGENT_REMOTE_SCREENSHOT_ACKNOWLEDGED
  )
  const { currentSessionId, createSession } = useChatSessions()
  const {
    acting,
    prefill,
    followUp,
    setActing,
    prefillComposer,
    clearFollowUp,
    submitFollowUp,
    settleFollowUp
  } = useAgentDraft()
  const candidateTab = useAgentCandidateTab()
  const [allowRoutineActions, setAllowRoutineActions] = useState(true)
  /**
   * Deliberately not durable, and scoped to the pair it was given for: a
   * confirmation that the user meant to run on a model whose tool calling is
   * their own override, which cannot outlive the model it was about.
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
  const run = snapshot.run
  const runInProgress = run !== undefined && !isTerminalAgentStatus(run.status)

  /** The run on screen, and the one it follows: what spends a draft's. */
  const shownRunId = run?.id
  const followedRunId = run?.previousRun?.handoff.runId
  const shownRun: AgentShownRun | undefined = shownRunId
    ? { id: shownRunId, ...(followedRunId ? { followedRunId } : {}) }
    : undefined
  useEffect(() => {
    settleFollowUp(
      shownRunId
        ? { id: shownRunId, ...(followedRunId ? { followedRunId } : {}) }
        : undefined
    )
  }, [settleFollowUp, shownRunId, followedRunId])

  /**
   * A task that was sent is waited for, not assumed. The box is cleared on
   * Start; the mode returns to Chat once the run it started is showing, and a
   * refused start puts the sentence back, so a pruned parent or an unusable
   * tab costs the user a click and not the goal they typed.
   */
  const pending = useRef<
    { text: string; shownRunId?: string; failure?: unknown } | undefined
  >(undefined)
  useEffect(() => {
    const sent = pending.current
    if (!sent || !shownRunId || shownRunId === sent.shownRunId) return
    pending.current = undefined
    setActing(false)
  }, [shownRunId, setActing])
  const failure = connection.failure
  useEffect(() => {
    const sent = pending.current
    if (!sent || !failure || failure === sent.failure) return
    if (failure.command !== "agent_start") return
    pending.current = undefined
    prefillComposer(sent.text)
  }, [failure, prefillComposer])

  const provider = snapshot.provider
  const tab = visibleAgentTab(snapshot.run, snapshot.tab, candidateTab)
  const remoteNeedsAcknowledgement = agentNeedsRemoteAcknowledgement(
    provider,
    acknowledged === true,
    screenshotsAcknowledged === true
  )
  const canSubmit = (text: string) =>
    Boolean(provider && tab && text) &&
    !runInProgress &&
    !remoteNeedsAcknowledgement &&
    /*
     * The same union the run is refused by, so Start is not live for a model
     * that would be refused after attaching to a tab.
     */
    agentReadinessPermitsStart(provider?.readiness, allowExperimentalModel) &&
    !connection.busy

  const submit = (text: string) => {
    /**
     * One task per Start. A second Enter before the first run shows or is
     * refused is the same intent twice; the service refuses a second
     * admission too, but a panel that sent it would show that refusal for a
     * run the user only meant to start once.
     */
    if (pending.current) return
    pending.current = {
      text,
      shownRunId,
      failure: connection.failure
    }
    if (followUp) submitFollowUp(shownRun)
    connection.start(
      text,
      allowRoutineActions,
      followUp && { parentRunId: followUp.parentRunId, mode: followUp.mode }
    )
  }

  /**
   * On a fresh install there is no chat and so no composer; the switch makes
   * one, the way Start chatting does, so the Agent is never unreachable until
   * the user has started a conversation they did not want.
   */
  const changeMode = (next: boolean) => {
    if (next && !currentSessionId) {
      void createSession().then(() => setActing(true))
      return
    }
    setActing(next)
  }

  const slots: AgentWorkspaceSlots = {
    toggle: <AgentModeToggle acting={acting} onChange={changeMode} />,
    mode: {
      active: acting,
      inputLabel: t("agent.start.goal"),
      placeholder: t(
        followUp?.mode === "continue"
          ? "agent.follow_up.placeholder"
          : "agent.start.placeholder"
      ),
      submitLabel: t("agent.start.action"),
      preflight: (
        <AgentActPreflight
          provider={provider}
          browser={snapshot.browser}
          tab={tab}
          failure={failure}
          followUp={followUp}
          onClearFollowUp={clearFollowUp}
          runInProgress={runInProgress}
          showRemoteNotice={remoteNeedsAcknowledgement}
          onAcknowledgePrivacy={(scope) => {
            void setAcknowledged(true)
            if (scope === "screenshots") void setScreenshotsAcknowledged(true)
          }}
          allowRoutineActions={allowRoutineActions}
          onAllowRoutineActions={setAllowRoutineActions}
          allowExperimentalModel={allowExperimentalModel}
          onAllowExperimentalModel={(allowed) =>
            setExperimentalModelRef(allowed ? selectedModelRef : undefined)
          }
        />
      ),
      canSubmit,
      submit,
      ...(prefill ? { prefill } : {})
    }
  }

  return (
    <AgentConnectionContext.Provider
      value={{ connection, ...(tab ? { tab } : {}) }}>
      {children(slots)}
    </AgentConnectionContext.Provider>
  )
}
