import { useTranslation } from "react-i18next"
import { StatusAlert } from "@/components/settings"
import { AlertTriangle } from "@/lib/lucide-icon"

export const PerformanceWarning = () => {
  const { t } = useTranslation()

  return (
    <StatusAlert
      variant="warning"
      icon={AlertTriangle}
      title={t("welcome.performance_notice.title")}
      description={t("welcome.performance_notice.message")}
    />
  )
}
