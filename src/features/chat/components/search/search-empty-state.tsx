import { useTranslation } from "react-i18next"
import { EmptyState } from "@/components/feedback"
import { Search } from "@/lib/lucide-icon"

export interface SearchEmptyStateProps {
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
      <EmptyState
        icon={Search}
        title={t("chat.search.no_results")}
        description={t("chat.search.no_results_description")}
        className="h-80"
      />
    )
  }

  if (!hasQuery) {
    return (
      <EmptyState
        icon={Search}
        title={t("chat.search.start_typing")}
        description={t("chat.search.start_typing_description")}
        className="h-80"
      />
    )
  }

  return null
}
