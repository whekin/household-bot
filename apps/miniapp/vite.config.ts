import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'
import { fileURLToPath } from 'url'

const configDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(configDir, 'src'),
      '@household/domain': path.resolve(configDir, '../../packages/domain/src/index.ts')
    }
  },
  server: {
    port: 3000
  },
  build: {
    target: 'esnext'
  }
})
