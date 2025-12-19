import { useTranslation } from "react-i18next"

import { SettingsCard } from "@/components/settings"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
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
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="show-session-metrics">
            {t("settings.chat_display.session_metrics_label")}
          </Label>
          <p className="text-sm text-muted-foreground">
            {t("settings.chat_display.session_metrics_description")}
          </p>
        </div>
        <Switch
          id="show-session-metrics"
          checked={showSessionMetrics}
          onCheckedChange={setShowSessionMetrics}
        />
      </div>
    </SettingsCard>
  )
}
