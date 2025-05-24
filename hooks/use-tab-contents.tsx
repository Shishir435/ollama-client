import { useSelectedTabs } from "@/context/selected-tab-context"
import { MESSAGE_KEYS } from "@/lib/constant"
import { useEffect, useState } from "react"

const fetchTabContent = (tabId: number) => {
  return new Promise<string>((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: MESSAGE_KEYS.BROWSER.GET_PAGE_CONTENT },
      (response) => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError.message)
        }
        resolve(response?.html || "")
      }
    )
  })
}
export const useTabContents = () => {
  const { selectedTabs, setErrors } = useSelectedTabs()
  const [tabContents, setTabContents] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (selectedTabs.length === 0) return

    const fetchAll = async () => {
      setLoading(true)
      const newContents: Record<number, string> = {}
      const newErrors: Record<number, string> = {}

      for (const idStr of selectedTabs) {
        const tabId = parseInt(idStr)
        try {
          const html = await fetchTabContent(tabId)
          // Optional: parse HTML to check it's valid, sanitize if needed
          newContents[tabId] = html
        } catch (err) {
          newErrors[tabId] = typeof err === "string" ? err : "Unknown error"
        }
      }

      setTabContents(newContents)
      setErrors(newErrors)
      setLoading(false)
    }

    fetchAll()
  }, [selectedTabs])

  return { tabContents, loading, errors: useSelectedTabs().errors }
}
