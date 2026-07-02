import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import obfuscator from 'vite-plugin-javascript-obfuscator';
import { visualizer } from 'rollup-plugin-visualizer';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    visualizer({
      filename: 'dist/stats.html',
      open: false,
      gzipSize: true,
      brotliSize: true,
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: "Pass'io Web Player — Lecteur de musique sécurisé",
        short_name: 'Passio',
        description: "Écoutez votre musique en toute sécurité avec Pass'io Web Player. Streaming haute qualité, mode hors-ligne, et bibliothèque personnelle.",
        theme_color: '#000000',
        background_color: '#0A0A0A',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        lang: 'fr-FR',
        categories: ['music', 'entertainment'],
        icons: [
          {
            src: '/assets/images/passio-icon-round.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/assets/images/passio-icon-round.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/assets/images/passio-icon-round.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https?:\/\/res\.cloudinary\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'passio-cloudinary-cache',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 jours
              },
            },
          },
          {
            urlPattern: /^https?:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'passio-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 60, // 60 jours
              },
            },
          },
          {
            urlPattern: /^https?:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'passio-font-files-cache',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 60, // 60 jours
              },
            },
          },
          {
            urlPattern: /^https?:\/\/.*backblazeb2\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'passio-cover-cache',
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 60 * 60 * 24 * 14, // 14 jours
              },
            },
          },
          {
            urlPattern: /^https?:\/\/(api\.passiio\.shop|pass-io\.onrender\.com)\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'passio-api-cache',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 jours
              },
              networkTimeoutSeconds: 10,
            },
          },
        ],
      },
    }),
    // Protection du bundle : obfuscation activée UNIQUEMENT en production
    mode === 'production' && obfuscator({
      options: {
        compact: true,
        controlFlowFlattening: false,
        deadCodeInjection: false,
        disableConsoleOutput: false,
        identifierNamesGenerator: 'mangled',
        renameGlobals: false,
        stringArray: true,
        stringArrayEncoding: ['base64'],
        stringArrayThreshold: 0.75,
        transformObjectKeys: false,
        unicodeEscapeSequence: false,
        splitStrings: true,
        splitStringsChunkLength: 10,
        debugProtection: false,
        selfDefending: false, // Désactivé pour compatibilité avec terser (minification post-obfuscation)
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5175,
    host: true,
  },
  build: {
    chunkSizeWarningLimit: 600,
    sourcemap: false, // Désactivé en prod : pas de source maps exposées
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false,
        drop_debugger: false,
        passes: 3,
      },
      format: {
        comments: false,
      },
    },
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom')) {
              return 'react-vendor';
            }
            if (id.includes('react-router') || id.includes('react-router-dom')) {
              return 'router-vendor';
            }
            if (id.includes('@tanstack/react-query')) {
              return 'query-vendor';
            }
            if (id.includes('lucide-react')) {
              return 'icons-vendor';
            }
            if (id.includes('hls.js')) {
              return 'hls-vendor';
            }
            if (id.includes('colorthief')) {
              return 'color-vendor';
            }
            if (id.includes('html2canvas')) {
              return 'canvas-vendor';
            }
            if (id.includes('aes-js') || id.includes('idb-keyval')) {
              return 'utils-vendor';
            }
          }
        },
      },
    },
  },
}));
