import { AlertTriangle } from "lucide-react"
import { useTranslation } from "react-i18next"
import { StatusAlert } from "@/components/settings"

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
