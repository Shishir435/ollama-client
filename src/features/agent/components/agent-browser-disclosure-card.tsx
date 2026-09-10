import type { AgentBrowserDisclosure } from "@ollama-client/contracts"
import { useTranslation } from "react-i18next"

/**
 * What the browser will do, shown before anything is asked of it.
 *
 * Chromium shows its own "is debugging this browser" banner the moment a run
 * attaches, and a banner with nothing beside it is what sends someone to ask
 * a developer what their extension is doing. Firefox has no debugger at all,
 * so the same run is quietly a different one — limits worth knowing while a
 * task is being chosen, rather than explained after it stalls.
 */
export const agentBrowserLimitKeys = (
  browser?: AgentBrowserDisclosure
): string[] => {
  if (!browser) return []
  const limits: string[] = []
  if (!browser.nativeInput) limits.push("agent.limits.no_native_input")
  if (!browser.screenshots) limits.push("agent.limits.no_screenshots")
  if (!browser.dialogs) limits.push("agent.limits.no_dialogs")
  return limits
}

export const AgentBrowserDisclosureCard = ({
  browser
}: {
  browser: AgentBrowserDisclosure
}) => {
  const { t } = useTranslation()
  const limits = agentBrowserLimitKeys(browser)

  return (
    <section className="mb-3 rounded-panel border border-border/50 bg-background/70 p-2.5 text-xs">
      <h2 className="font-medium">{t("agent.attachment.title")}</h2>
      <p className="mt-1 text-muted-foreground">
        {t(
          browser.attaches
            ? "agent.attachment.attaches"
            : "agent.attachment.no_debugger"
        )}
      </p>
      {limits.length > 0 && (
        <ul className="mt-1.5 list-disc pl-4 text-muted-foreground">
          {limits.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
