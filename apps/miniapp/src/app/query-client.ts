import { QueryClient } from '@tanstack/solid-query'

export const miniAppQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000
    }
  }
})
