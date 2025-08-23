import { CheckIcon, Loader2, TriangleAlert } from "lucide-react"

export const StatusIcon = ({
  loading,
  error
}: {
  loading: boolean
  error: Error | string | null
}) => {
  if (loading) {
    return (
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground dark:text-muted" />
    )
  }

  if (error) {
    return <TriangleAlert className="h-4 w-4 text-red-500 dark:text-red-400" />
  }

  return <CheckIcon className="h-4 w-4 text-green-500 dark:text-green-400" />
}
