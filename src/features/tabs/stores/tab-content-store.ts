import { useEffect } from "react"

import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"

import { useTabContents } from "@/features/tabs/hooks/use-tab-contents"
import { useSelectedTabs } from "@/features/tabs/stores/selected-tabs-store"
import type { TabContentState } from "@/types"

export const useTabContentStore = create<TabContentState>((set) => ({
  builtContent: "",
  documents: [],
  setBuiltContent: (builtContent: string) => set({ builtContent }),
  setDocuments: (documents) => set({ documents })
}))

export const useTabContent = () => {
  const { selectedTabIds, errors } = useSelectedTabs()
  const { tabContents } = useTabContents()
  const { builtContent, documents, setBuiltContent, setDocuments } =
    useTabContentStore(
      useShallow((s) => ({
        builtContent: s.builtContent,
        documents: s.documents,
        setBuiltContent: s.setBuiltContent,
        setDocuments: s.setDocuments
      }))
    )

  useEffect(() => {
    const built = selectedTabIds
      .map((id, index) => {
        const tabId = parseInt(id, 10)
        const content = tabContents[tabId]
        const title = content?.title || "Untitled"
        const header = `Context-${index + 1}`

        // Calm parenthetical, not "❌ Error:" — this string is fed to the model
        // as page context, and models tend to echo alarming error text verbatim
        // into their answer.
        if (errors[tabId]) {
          return `${header}\nTitle: ${title}\nContent:\n(This tab could not be read: ${errors[tabId]})`
        }

        if (!content) {
          return `${header}\nTitle: ${title}\nContent:\n(No content)`
        }

        return `${header}\nTitle: ${title}\nContent:\n${content.html}`
      })
      .join("\n\n---\n\n")

    setBuiltContent(built)
    const docs = selectedTabIds
      .map((id) => {
        const tabId = parseInt(id, 10)
        const content = tabContents[tabId]
        if (!content || errors[tabId]) return null
        return {
          id,
          title: content.title || "Untitled",
          content: content.html,
          capturedAt: content.extractionDebug?.capturedAt || Date.now(),
          revisionId: content.extractionDebug?.revisionId
        }
      })
      .filter(Boolean)
      .sort((a, b) => (b?.capturedAt || 0) - (a?.capturedAt || 0)) as Array<{
      id: string
      title: string
      content: string
      capturedAt: number
      revisionId?: string
    }>
    setDocuments(docs)
  }, [selectedTabIds, errors, tabContents, setBuiltContent, setDocuments])

  return { builtContent, documents }
}
