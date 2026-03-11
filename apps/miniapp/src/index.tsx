/* @refresh reload */
import { QueryClientProvider } from '@tanstack/solid-query'
import { render } from 'solid-js/web'

import { miniAppQueryClient } from './app/query-client'
import './index.css'
import App from './App'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Root element not found')
}

render(
  () => (
    <QueryClientProvider client={miniAppQueryClient}>
      <App />
    </QueryClientProvider>
  ),
  root
)
