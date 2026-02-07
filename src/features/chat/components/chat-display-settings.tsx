import { useTranslation } from "react-i18next"

import { SettingsCard, ToggleRow } from "@/components/settings"
import { useSessionMetricsPreference } from "@/features/chat/hooks/use-session-metrics-preference"
import { MessageSquare } from "@/lib/lucide-icon"

export const ChatDisplaySettings = () => {
  const { t } = useTranslation()
  const [showSessionMetrics, setShowSessionMetrics] =
    useSessionMetricsPreference()

  return (
    <SettingsCard
      icon={MessageSquare}
      title={t("settings.chat_display.title")}
      description={t("settings.chat_display.description")}>
      <ToggleRow
        id="show-session-metrics"
        label={t("settings.chat_display.session_metrics_label")}
        description={t("settings.chat_display.session_metrics_description")}
        checked={showSessionMetrics}
        onCheckedChange={setShowSessionMetrics}
      />
    </SettingsCard>
  )
}
