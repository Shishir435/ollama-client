import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { openOptionsInTab, runtime } from "@/lib/browser-api"
import { ShieldCheck } from "@/lib/lucide-icon"

export const PrivacyStatusChip = () => {
  const { t } = useTranslation()

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 gap-1 rounded-chip px-2 text-micro text-status-success"
      title={t("settings.privacy_spine.header_tooltip")}
      onClick={() =>
        void openOptionsInTab(runtime.getURL("options.html?tab=privacy"))
      }>
      <ShieldCheck className="icon-xs" />
      {t("settings.privacy_spine.local_chip")}
    </Button>
  )
}
