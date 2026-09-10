import type { AgentRunState } from "@ollama-client/contracts"
import { useTranslation } from "react-i18next"

import type {
  AgentProviderPresentation,
  AgentTabPresentation
} from "../agent-view"
import { AGENT_PAGE_TEXT_LIMIT, agentPlainText } from "../lib/presentation"

/** Which endpoint, which model, whether pictures travel, and what it drives. */
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
  tab
}: {
  run?: AgentRunState | null
  provider?: AgentProviderPresentation
  tab?: AgentTabPresentation
}) => {
  const { t } = useTranslation()
  /** The tab it started on plus every tab it has adopted since. */
  const controlledTabs = run
    ? new Set([run.controlledTabId, ...(run.scopedTabIds ?? [])]).size
    : 0

  return (
    <section className="mb-3 grid min-w-0 gap-1.5 rounded-panel border border-border/50 bg-background/70 p-2.5 text-xs">
      <Row
        label={t("agent.provider.label")}
        value={
          provider
            ? `${agentPlainText(provider.name, 100)} · ${t(`agent.provider.${provider.location}`)}`
            : t("agent.provider.missing")
        }
      />
      <div className="flex min-w-0 gap-2">
        <span className="shrink-0 text-muted-foreground">
          {t("agent.model.label")}
        </span>
        <span className="min-w-0 flex-1 truncate text-right font-mono">
          {/* During a run the truth is the model that produced its steps,
              not whatever is selected in Chat right now. */}
          {run?.modelId
            ? agentPlainText(run.modelId, 100)
            : provider
              ? agentPlainText(provider.model, 100)
              : t("agent.provider.missing")}
        </span>
      </div>
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
