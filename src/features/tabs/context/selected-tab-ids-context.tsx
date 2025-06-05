import { createContext, useContext, useState, type ReactNode } from "react"

interface SelectedTabIdsContextType {
  selectedTabIds: string[]
  setSelectedTabIds: (tabs: string[]) => void
  errors: Record<number, string>
  setErrors: (errors: Record<number, string>) => void
}

export const SelectedTabIdsContext = createContext<
  SelectedTabIdsContextType | undefined
>(undefined)

export const SelectedTabsProvider = ({ children }: { children: ReactNode }) => {
  const [selectedTabIds, setSelectedTabIds] = useState<string[]>([])
  const [errors, setErrors] = useState<Record<number, string>>({})

  return (
    <SelectedTabIdsContext.Provider
      value={{ selectedTabIds, setSelectedTabIds, errors, setErrors }}>
      {children}
    </SelectedTabIdsContext.Provider>
  )
}

export const useSelectedTabIds = () => {
  const context = useContext(SelectedTabIdsContext)
  if (!context) {
    throw new Error(
      "useSelectedTabs must be used within a SelectedTabsProvider"
    )
  }
  return context
}
