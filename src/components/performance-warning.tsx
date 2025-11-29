import { useTranslation } from "react-i18next"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export const PerformanceWarning = () => {
  const { t } = useTranslation()

  return (
    <Card className="mt-6 border-yellow-500 bg-yellow-50 dark:bg-yellow-950">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-yellow-800 dark:text-yellow-300">
          {t("welcome.performance_notice.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-yellow-900 dark:text-yellow-200">
        {t("welcome.performance_notice.message")}
      </CardContent>
    </Card>
  )
}
