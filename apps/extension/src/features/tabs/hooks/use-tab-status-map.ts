import { useTabContents } from "@/features/tabs/hooks/use-tab-contents"

export const useTabStatusMap = () => {
  const { tabContents, loadingIds, errors } = useTabContents()

  return (tabId: string) => {
    const tabIdNum = parseInt(tabId, 10)

    return {
      loading: loadingIds?.[tabIdNum] || false,
      error: errors?.[tabIdNum] || null,
      data: tabContents?.[tabIdNum] || null
    }
  }
}
