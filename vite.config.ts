import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
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
      // ✅ Le nouveau SW s'active IMMÉDIATEMENT sans attendre la fermeture de l'onglet
      injectRegister: 'auto',

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
        // ✅ Activation immédiate du nouveau Service Worker pour tous les utilisateurs
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // ⚡ Exclure les icônes du manifest de la pré-cache automatique pour éviter
        // le conflit de révision (brute vs ?__WB_REVISION__=…) qui cause des warnings
        // et des erreurs de cache dans le Service Worker.
        globIgnores: [
          '**/passio-icon-round.png',
          '**/icon.png',
          '**/favicon*',
        ],
        // ⚡ Offline shell : l'app s'ouvre même sans connexion
        navigateFallback: '/index.html',
        navigateFallbackAllowlist: [
          // Permet les routes de l'app (/discover, /album/123, /artist/abc, /)
          // mais bloque les requêtes API /api/*
          /^\/(|[^/]+(\/.*)?)$/,
        ],
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
            // ⚡ ImageKit (fallback quand Cloudinary est down)
            urlPattern: /^https?:\/\/ik\.imagekit\.io\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'passio-imagekit-cache',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 jours
              },
            },
          },
          {
            // ⚡ wsrv.nl (proxy d'optimisation d'images)
            urlPattern: /^https?:\/\/wsrv\.nl\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'passio-wsrv-cache',
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 60 * 60 * 24 * 14, // 14 jours
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
            // ⚡ Audio Cloudflare CDN (pistes gratuites) : Cache-First
            urlPattern: /^https?:\/\/api\.passiio\.shop\/audio\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'passio-audio-cache',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 an (fichiers statiques)
              },
            },
          },
          {
            // ⚡ Audio proxy backend (pistes payantes) : Cache-First
            urlPattern: /^https?:\/\/api\.passiio\.shop\/api\/stream\/tracks\/.*\/audio/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'passio-audio-cache',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
          {
            // 🚫 Endpoints API DYNAMIQUES (albums, tracks, artistes, auth…)
            // → NetworkOnly : JAMAIS de cache. Toujours les données fraîches du serveur.
            urlPattern: /^https?:\/\/(api\.passiio\.shop|pass-io\.onrender\.com)\/api\/.*/i,
            handler: 'NetworkOnly',
          },
          {
            // ⚡ Autres ressources non-/api/ sur nos domaines (health, favicon backend…)
            // → NetworkFirst courte durée (fallback offline de 5 min max)
            urlPattern: /^https?:\/\/(api\.passiio\.shop|pass-io\.onrender\.com)\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'passio-api-misc-cache',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 5, // 5 minutes max
              },
              networkTimeoutSeconds: 8,
            },
          },
        ],
      },
    }),
    // Protection du bundle : obfuscation activée UNIQUEMENT en production
    mode === 'production' && obfuscator({
      // ⚠️ CRITIQUE : exclure les fichiers qui contiennent des dynamic imports.
      // L'obfuscateur encode les chaînes en base64 (stringArrayEncoding),
      // ce qui brise la résolution des chemins dans import('./keyManager') → GET /assets/keyManager sans hash ni .js.
      exclude: [
        // Services avec dynamic imports critiques
        /src[\/\\]services[\/\\](keyManager|vault|api|offlineCache|storage)\.ts$/,
        /src[\/\\]contexts[\/\\]LibraryModeContext\.tsx$/,
        // 🔴 CRITIQUE : App.tsx contient TOUS les React.lazy / dynamic imports.
        // L'obfuscateur encode les chaînes (dont les chemins d'import) en base64,
        // ce qui brise la résolution des chunks au runtime.
        /src[\/\\]App\.tsx$/,
        // Toutes les pages chargées dynamiquement via lazy() — même protection
        /src[\/\\]pages[\/\\]/,
      ],
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
    } as Parameters<typeof obfuscator>[0]),
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
          // ── Chunk nommé stable pour keyManager ──
          // keyManager est chargé via dynamic import depuis vault.ts et LibraryModeContext.
          // Un nom stable (sans hash aléatoire qui change à chaque build) garantit
          // que le chemin résolu en runtime correspond au fichier existant dans dist/assets/.
          if (id.includes('src/services/keyManager') || id.includes('src\\services\\keyManager')) {
            return 'keyManager';
          }
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
