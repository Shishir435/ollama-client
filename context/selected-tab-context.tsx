import { createContext, useContext, useState, type ReactNode } from "react"

interface SelectedTabsContextType {
  selectedTabs: string[]
  setSelectedTabs: (tabs: string[]) => void
  errors: Record<number, string>
  setErrors: (errors: Record<number, string>) => void
}

export const SelectedTabsContext = createContext<
  SelectedTabsContextType | undefined
>(undefined)

export const SelectedTabsProvider = ({ children }: { children: ReactNode }) => {
  const [selectedTabs, setSelectedTabs] = useState<string[]>([])
  const [errors, setErrors] = useState<Record<number, string>>({})

  return (
    <SelectedTabsContext.Provider
      value={{ selectedTabs, setSelectedTabs, errors, setErrors }}>
      {children}
    </SelectedTabsContext.Provider>
  )
}

export const useSelectedTabs = () => {
  const context = useContext(SelectedTabsContext)
  if (!context) {
    throw new Error(
      "useSelectedTabs must be used within a SelectedTabsProvider"
    )
  }
  return context
}
