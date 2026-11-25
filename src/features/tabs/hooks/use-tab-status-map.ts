import { useTabContents } from "@/features/tabs/hooks/use-tab-contents"

export const useTabStatusMap = () => {
  const { tabContents, loadingIds, errors, issues } = useTabContents()

  return (tabId: string) => {
    const tabIdNum = parseInt(tabId, 10)

    return {
      loading: loadingIds?.[tabIdNum] || false,
      error: errors?.[tabIdNum] || null,
      /** What to tell the user; `error` is the model's text for the same tab. */
      issue: issues?.[tabIdNum] ?? null,
      data: tabContents?.[tabIdNum] || null
    }
  }
}
