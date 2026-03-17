import { useTranslation } from "react-i18next"
import { Search } from "@/lib/lucide-icon"

interface SearchEmptyStateProps {
  hasQuery: boolean
  hasResults: boolean
}

export const SearchEmptyState = ({
  hasQuery,
  hasResults
}: SearchEmptyStateProps) => {
  const { t } = useTranslation()

  if (hasQuery && !hasResults) {
    return (
      <div className="flex h-80 flex-col items-center justify-center text-center px-4">
        <div className="bg-muted/30 p-4 rounded-full mb-4">
          <Search className="h-8 w-8 text-muted-foreground/40" />
        </div>
        <h3 className="text-sm font-medium text-foreground mb-1">
          {t("chat.search.no_results")}
        </h3>
        <p className="text-xs text-muted-foreground max-w-[200px]">
          {t("chat.search.no_results_description") ||
            "Try adjusting your keywords or search scope."}
        </p>
      </div>
    )
  }

  if (!hasQuery) {
    return (
      <div className="flex h-80 flex-col items-center justify-center text-center px-4">
        <div className="bg-primary/5 p-4 rounded-full mb-4">
          <Search className="h-8 w-8 text-primary/30" />
        </div>
        <h3 className="text-sm font-medium text-foreground mb-1">
          {t("chat.search.start_typing")}
        </h3>
        <p className="text-xs text-muted-foreground max-w-[200px]">
          {t("chat.search.start_typing_description") ||
            "Search through your chat history using semantic search."}
        </p>
      </div>
    )
  }

  return null
}
