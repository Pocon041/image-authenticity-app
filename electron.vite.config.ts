import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { build: { externalizeDeps: true } },
  preload: { build: { externalizeDeps: true } },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [
      react(),
      {
        name: 'development-csp',
        apply: 'serve',
        transformIndexHtml(html) {
          // React refresh injects an inline preamble in development only.
          return html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
        }
      }
    ],
    server: { host: '127.0.0.1', port: 5173, strictPort: true }
  }
})
