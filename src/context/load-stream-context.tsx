import React, {
  createContext,
  useContext,
  useState,
  type ReactNode
} from "react"

interface LoadStreamContextType {
  isLoading: boolean
  setIsLoading: (loading: boolean) => void
  isStreaming: boolean
  setIsStreaming: (streaming: boolean) => void
}

const LoadStreamContext = createContext<LoadStreamContextType | undefined>(
  undefined
)

export const LoadStreamProvider = ({ children }: { children: ReactNode }) => {
  const [isLoading, setIsLoading] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)

  return (
    <LoadStreamContext.Provider
      value={{ isLoading, setIsLoading, isStreaming, setIsStreaming }}>
      {children}
    </LoadStreamContext.Provider>
  )
}

export const useLoadStream = () => {
  const context = useContext(LoadStreamContext)
  if (!context) {
    throw new Error("useLoadStream must be used within a LoadStreamProvider")
  }
  return context
}
