import { useTranslation } from "react-i18next"
import { Skeleton } from "@/components/ui/skeleton"

export const ChatMessageLoadingIndicator = ({
  label,
  showDots = false
}: {
  label?: string
  showDots?: boolean
}) => {
  const { t } = useTranslation()
  const displayLabel = label || t("chat.message.loading")

  return (
    <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
      <span className="sr-only">{displayLabel}</span>
      {showDots ? (
        <div className="flex h-5 items-center gap-1" aria-hidden="true">
          <div className="size-1 animate-pulse rounded-chip bg-current" />
          <div
            className="size-1 animate-pulse rounded-chip bg-current"
            style={{ animationDelay: "150ms" }}
          />
          <div
            className="size-1 animate-pulse rounded-chip bg-current"
            style={{ animationDelay: "300ms" }}
          />
        </div>
      ) : (
        <div className="grid w-full max-w-md gap-2" aria-hidden="true">
          <Skeleton className="h-3 w-[88%] rounded-control" />
          <Skeleton className="h-3 w-[64%] rounded-control" />
        </div>
      )}
    </div>
  )
}
