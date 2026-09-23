import type { AgentRunState } from "@ollama-client/contracts"
import { useTranslation } from "react-i18next"

import {
  AGENT_PAGE_TEXT_LIMIT,
  type AgentProviderPresentation,
  type AgentTabPresentation,
  agentPlainText
} from "../lib/presentation"

/** Whether pictures travel, what the run drives, and how many tabs. */
const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex min-w-0 gap-2">
    <span className="shrink-0 text-muted-foreground">{label}</span>
    <span className="min-w-0 flex-1 truncate text-right">{value}</span>
  </div>
)

/** Absent is shown as unknown, never as "not used": a picture may still be sent. */
const screenshotsKey = (provider?: AgentProviderPresentation): string =>
  provider?.screenshots === true
    ? "agent.screenshots.sent"
    : provider?.screenshots === false
      ? "agent.screenshots.unused"
      : "agent.screenshots.unknown"

export const AgentRunDetailsCard = ({
  run,
  provider,
  tab,
  pinnedModel = false
}: {
  run?: AgentRunState | null
  provider?: AgentProviderPresentation
  tab?: AgentTabPresentation
  /**
   * Name the run's model whatever the picker says. A live run is supervised
   * from its card in the chat, beside the chat's own model picker: that
   * picker changes the next message, never the run, whose model was fixed
   * when it started — and a card that fell silent when the two matched would
   * let a switch look as though it had reached the run.
   */
  pinnedModel?: boolean
}) => {
  const { t } = useTranslation()
  /** The tab it started on plus every tab it has adopted since. */
  const controlledTabs = run
    ? new Set([run.controlledTabId, ...(run.scopedTabIds ?? [])]).size
    : 0

  return (
    <section className="mb-3 grid min-w-0 gap-1.5 rounded-panel border border-border bg-surface-sunken p-2.5 text-xs">
      {/*
        The provider and the model are on the control row below, next to the
        picker that changes them, so stating them again here was the card
        repeating what the panel already said.

        The exception is a run whose model is no longer the selected one: a
        finished run was produced by whatever was chosen when it started, and
        the picker cannot say that. So the row appears exactly when leaving it
        out would let the panel imply the wrong model produced these steps.
      */}
      {run?.modelId && (pinnedModel || run.modelId !== provider?.model) && (
        <div className="flex min-w-0 gap-2">
          <span className="shrink-0 text-muted-foreground">
            {t("agent.model.label")}
          </span>
          <span className="min-w-0 flex-1 truncate text-right font-mono">
            {agentPlainText(run.modelId, 100)}
          </span>
        </div>
      )}
      <Row
        label={t("agent.screenshots.label")}
        value={t(screenshotsKey(provider))}
      />
      <Row
        label={t("agent.tab.label")}
        value={
          tab
            ? agentPlainText(tab.title || tab.url, AGENT_PAGE_TEXT_LIMIT)
            : t("agent.tab.missing")
        }
      />
      {/* A run adopts the tabs it opens, so the tab it started on stops being
          the whole answer to "what is it driving". */}
      {controlledTabs > 1 && (
        <Row
          label={t("agent.tabs.label")}
          value={t("agent.tabs.count", { count: controlledTabs })}
        />
      )}
    </section>
  )
}
