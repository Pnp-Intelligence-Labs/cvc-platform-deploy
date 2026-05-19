import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      base: '/app/',
      scope: '/app/',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: '/app/index.html',
        navigateFallbackDenylist: [/^\/(?!app)/],
        runtimeCaching: [
          {
            urlPattern: /^https?:\/\/.*\/api\//,
            handler: 'NetworkFirst',
            options: { cacheName: 'api-cache', networkTimeoutSeconds: 10 },
          },
        ],
      },
      manifest: {
        name: 'SLAM Intelligence',
        short_name: 'SLAM',
        description: 'Claw Venture Capital — Investment Intelligence Platform',
        theme_color: '#151411',
        background_color: '#151411',
        display: 'standalone',
        scope: '/app/',
        start_url: '/app/',
        orientation: 'portrait-primary',
        icons: [
          { src: '/app/icon-72x72.png',   sizes: '72x72',   type: 'image/png' },
          { src: '/app/icon-96x96.png',   sizes: '96x96',   type: 'image/png' },
          { src: '/app/icon-128x128.png', sizes: '128x128', type: 'image/png' },
          { src: '/app/icon-144x144.png', sizes: '144x144', type: 'image/png' },
          { src: '/app/icon-152x152.png', sizes: '152x152', type: 'image/png' },
          { src: '/app/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/app/icon-384x384.png', sizes: '384x384', type: 'image/png' },
          { src: '/app/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: '/app/',
  build: {
    outDir: '../../api/static/app',
    emptyOutDir: true,
  },
  assetsInclude: ['**/*.svg', '**/*.csv'],
  server: {
    proxy: {
      '/auth': 'http://localhost:8001',
      '/news': 'http://localhost:8001',
      '/partners': 'http://localhost:8001',
      '/companies': 'http://localhost:8001',
      '/home': 'http://localhost:8001',
      '/intelligence': 'http://localhost:8001',
      '/sourcing': 'http://localhost:8001',
      '/dealflow': 'http://localhost:8001',
      '/shortlists': 'http://localhost:8001',
      '/admin': 'http://localhost:8001',
      '/tasks': 'http://localhost:8001',
      '/lp': 'http://localhost:8001',
      '/trends': 'http://localhost:8001',
      '/industrial': 'http://localhost:8001',
      '/portfolio': 'http://localhost:8001',
      '/review': 'http://localhost:8001',
      '/notifications': 'http://localhost:8001',
      '/brambles': 'http://localhost:8001',
      '/ventures': 'http://localhost:8001',
      '/skirmishes': 'http://localhost:8001',
      '/health': 'http://localhost:8001',
      '/reports': 'http://localhost:8001',
    },
  },
})
