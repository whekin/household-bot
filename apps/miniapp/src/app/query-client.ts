import { QueryClient } from '@tanstack/react-query'
import { shouldRetryMiniAppQuery } from '@/api/client'

export const miniAppQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: shouldRetryMiniAppQuery,
      refetchOnWindowFocus: false
    }
  }
})
