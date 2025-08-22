import { useEffect } from "react"

import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"

import { useTabContents } from "@/features/tabs/hooks/use-tab-contents"
import { useSelectedTabs } from "@/features/tabs/stores/selected-tabs-store"
import type { TabContentState } from "@/types"

export const useTabContentStore = create<TabContentState>((set) => ({
  builtContent: "",
  setBuiltContent: (builtContent: string) => set({ builtContent })
}))

export const useTabContent = () => {
  const { selectedTabIds, errors } = useSelectedTabs()
  const { tabContents } = useTabContents()
  const { builtContent, setBuiltContent } = useTabContentStore(
    useShallow((s) => ({
      builtContent: s.builtContent,
      setBuiltContent: s.setBuiltContent
    }))
  )

  useEffect(() => {
    const built = selectedTabIds
      .map((id, index) => {
        const tabId = parseInt(id)
        const content = tabContents[tabId]
        const title = content?.title || "Untitled"
        const header = `Context-${index + 1}`

        if (errors[tabId]) {
          return `${header}\nTitle: ${title}\nContent:\n❌ Error: ${errors[tabId]}`
        }

        if (!content) {
          return `${header}\nTitle: ${title}\nContent:\n(No content)`
        }

        return `${header}\nTitle: ${title}\nContent:\n${content.html}`
      })
      .join("\n\n---\n\n")

    setBuiltContent(built)
  }, [selectedTabIds, errors, tabContents, setBuiltContent])

  return { builtContent }
}
