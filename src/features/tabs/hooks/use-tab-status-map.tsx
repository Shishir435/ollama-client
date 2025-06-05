import { useTabContents } from "@/features/tabs/hooks/use-tab-contents"

export function useTabStatusMap() {
  const { tabContents, loading, errors } = useTabContents()

  return (tabId: string) => {
    const tabIdNum = parseInt(tabId)

    return {
      loading,
      error: errors?.[tabIdNum] || null,
      data: tabContents?.[tabIdNum] || null
    }
  }
}
