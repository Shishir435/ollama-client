import { useTranslation } from "react-i18next"

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
    <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
      <span>{displayLabel}</span>
      {showDots ? (
        <div className="flex gap-1">
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
        <span className="text-micro text-muted-foreground">⏳</span>
      )}
    </div>
  )
}
