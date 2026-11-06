import { ExternalLink } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { openExternalUrl } from "@/lib/browser-api"
import { cn } from "@/lib/class-names"
import { EXTERNAL_URLS } from "@/lib/constants/urls"

export const SetupGuideLink = ({ className }: { className?: string }) => {
  const { t } = useTranslation()

  return (
    <Button
      variant="link"
      onClick={() => openExternalUrl(EXTERNAL_URLS.SETUP_GUIDE)}
      className={cn(
        "group inline-flex items-center gap-2 text-sm font-medium text-primary underline underline-offset-4 transition-colors hover:text-primary-hover",
        className
      )}>
      <ExternalLink className="icon-md shrink-0" />
      <span>
        {t("welcome.setup_guide.help_prefix")}{" "}
        {t("welcome.setup_guide.full_guide_link")}
      </span>
    </Button>
  )
}
