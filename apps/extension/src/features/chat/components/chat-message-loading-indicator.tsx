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
    <div className="mt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
      <span>{displayLabel}</span>
      {showDots ? (
        <div className="flex gap-1">
          <div className="h-1 w-1 animate-pulse rounded-full bg-current" />
          <div
            className="h-1 w-1 animate-pulse rounded-full bg-current"
            style={{ animationDelay: "150ms" }}
          />
          <div
            className="h-1 w-1 animate-pulse rounded-full bg-current"
            style={{ animationDelay: "300ms" }}
          />
        </div>
      ) : (
        <span className="text-[10px] text-muted-foreground">⏳</span>
      )}
    </div>
  )
}
