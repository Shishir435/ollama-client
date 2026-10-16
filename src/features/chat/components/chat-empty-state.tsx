import { useTranslation } from "react-i18next"
import { ProviderStatusCard } from "./provider-status-card"

/** What an empty chat shows above the composer: the product, and any blocker. */
export const ChatEmptyState = () => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-auto px-4 py-6 scrollbar-none">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("welcome.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("welcome.subtitle")}</p>
      </div>
      <ProviderStatusCard />
    </div>
  )
}
