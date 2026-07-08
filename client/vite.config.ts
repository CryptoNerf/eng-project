import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves the app from /<repo>/ — set VITE_BASE in CI
  base: process.env.VITE_BASE || '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Эмиль гений — английский по YouTube',
        short_name: 'Эмиль гений',
        description:
          'Учи английский по любимым YouTube-видео: карточки, перевод, контекст и интервальные повторения.',
        lang: 'ru',
        display: 'standalone',
        background_color: '#f4f2ea',
        theme_color: '#f4f2ea',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          // the artwork has wide safe margins, so the same file works maskable
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // Google Fonts styles + files
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            // video thumbnails
            urlPattern: /^https:\/\/i\.ytimg\.com\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'yt-thumbs',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
