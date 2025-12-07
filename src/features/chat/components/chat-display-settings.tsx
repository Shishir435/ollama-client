import { useTranslation } from "react-i18next"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useSessionMetricsPreference } from "@/features/chat/hooks/use-session-metrics-preference"
import { MessageSquare } from "@/lib/lucide-icon"

export const ChatDisplaySettings = () => {
  const { t } = useTranslation()
  const [showSessionMetrics, setShowSessionMetrics] =
    useSessionMetricsPreference()

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-5 text-muted-foreground" />
          <CardTitle className="text-lg">
            {t("settings.chat_display.title", { defaultValue: "Chat Display" })}
          </CardTitle>
        </div>
        <CardDescription>
          {t("settings.chat_display.description", {
            defaultValue: "Configure how chat information is displayed"
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="show-session-metrics">
              {t("settings.chat_display.session_metrics_label", {
                defaultValue: "Show Session Metrics"
              })}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t("settings.chat_display.session_metrics_description", {
                defaultValue:
                  "Display token usage, duration, and speed above the chat input"
              })}
            </p>
          </div>
          <Switch
            id="show-session-metrics"
            checked={showSessionMetrics}
            onCheckedChange={setShowSessionMetrics}
          />
        </div>
      </CardContent>
    </Card>
  )
}
