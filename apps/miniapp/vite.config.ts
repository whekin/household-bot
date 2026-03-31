import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'
import devtools from 'solid-devtools/vite'
import path from 'path'

export default defineConfig({
  plugins: [devtools(), solidPlugin(), tailwindcss()],
  resolve: {
    alias: {
      '@household/domain': path.resolve(__dirname, '../../packages/domain/src/index.ts')
    }
  },
  server: {
    port: 3000
  },
  build: {
    target: 'esnext'
  }
})
