import { useSelectedTabIds } from "@/context/selected-tab-ids-context"
import { useTabContents } from "@/hooks/use-tab-contents"
import React, { createContext, useContext, useMemo } from "react"

const TabContentContext = createContext<string>("")

export const TabContentContextProvider = ({ children }) => {
  const { tabContents, errors } = useTabContents()
  const { selectedTabIds } = useSelectedTabIds()

  const builtContentContext = useMemo(() => {
    return selectedTabIds
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
  }, [tabContents, selectedTabIds, errors])

  return (
    <TabContentContext.Provider value={builtContentContext}>
      {children}
    </TabContentContext.Provider>
  )
}

export const useTabContentContext = () => {
  return useContext(TabContentContext)
}
