import { CheckIcon, Loader2, TriangleAlert } from "@/lib/lucide-icon"
import { STATUS_STYLES } from "@/lib/ui-status"

export const StatusIcon = ({
  loading,
  error
}: {
  loading: boolean
  error: Error | string | null
}) => {
  if (loading) {
    return (
      <Loader2
        className={`h-4 w-4 animate-spin ${STATUS_STYLES.neutral.text}`}
      />
    )
  }

  if (error) {
    return <TriangleAlert className={`h-4 w-4 ${STATUS_STYLES.danger.text}`} />
  }

  return <CheckIcon className={`h-4 w-4 ${STATUS_STYLES.success.text}`} />
}
