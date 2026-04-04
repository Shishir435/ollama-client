import { QueryClient } from "@tanstack/react-query"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      // 30s before a cached result is considered stale — good default for
      // provider model lists and version info that don't change frequently.
      staleTime: 1000 * 30
    }
  }
})
