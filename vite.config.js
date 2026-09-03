import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Drop chatty console.log from the shipped bundle, but keep warn/error/info —
  // the migration and storage-failure diagnostics rely on those.
  esbuild: { pure: ['console.log'], drop: ['debugger'] },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'sql-wasm.wasm'],
      manifest: {
        name: 'Jeo Trainer',
        short_name: 'Jeo Trainer',
        description: 'Track your Jeopardy Coryat score and study missed clues with spaced repetition',
        theme_color: '#060b1a',
        background_color: '#060b1a',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        // wasm is deliberately not precached: sql-wasm.wasm is ~1.5 MB and only the
        // .apkg import and export need it, so every visitor was downloading it up front
        // for a feature most never touch. The runtime rule below caches it on first use.
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: /sql-wasm\.wasm$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'wasm-cache',
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 30 },
            }
          },
          {
            urlPattern: /^https:\/\/jeotrainer\.netlify\.app\/assets\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'assets-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 }
            }
          }
        ]
      }
    })
  ],
  optimizeDeps: {
    exclude: ['sql.js']
  },
  // Dev server headers (not needed for prod — netlify.toml handles that)
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  // The production Content-Security-Policy, mirrored from netlify.toml so that
  // `vite preview` serves the real bundle under the real policy. Keep the two in step —
  // netlify.toml is the one that actually ships.
  preview: {
    headers: {
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https://j-archive.com https://www.j-archive.com https://uramupgwxuugdcmmklds.supabase.co; media-src 'self' data: blob: https://uramupgwxuugdcmmklds.supabase.co; connect-src 'self' https://uramupgwxuugdcmmklds.supabase.co wss://uramupgwxuugdcmmklds.supabase.co https://raw.githubusercontent.com; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    }
  }
})
