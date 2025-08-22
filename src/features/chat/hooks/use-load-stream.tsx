import { loadStreamStore } from "@/features/chat/stores/load-stream-store"

export const useLoadStream = () => {
  const isLoading = loadStreamStore((s) => s.isLoading)
  const setIsLoading = loadStreamStore((s) => s.setIsLoading)
  const isStreaming = loadStreamStore((s) => s.isStreaming)
  const setIsStreaming = loadStreamStore((s) => s.setIsStreaming)

  return { isLoading, setIsLoading, isStreaming, setIsStreaming }
}
