import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import obfuscator from 'vite-plugin-javascript-obfuscator';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const isProduction = mode === 'production';
  const isLocalActive = env.VITE_LOCAL === 'active';

  return {
    plugins: [
      react(),
      visualizer({
        filename: 'dist/stats.html',
        open: true,
        gzipSize: true,
        brotliSize: true,
      }),
      isProduction && !isLocalActive
        ? obfuscator({
            options: {
              compact: true,
              controlFlowFlattening: true,
              controlFlowFlatteningThreshold: 0.75,
              deadCodeInjection: true,
              deadCodeInjectionThreshold: 0.4,
              debugProtection: true,
              debugProtectionInterval: 4000,
              disableConsoleOutput: true,
              identifierNamesGenerator: 'hexadecimal',
              log: false,
              numbersToExpressions: true,
              renameGlobals: false,
              selfDefending: true,
              simplify: true,
              splitStrings: true,
              splitStringsChunkLength: 10,
              stringArray: true,
              stringArrayCallsTransform: true,
              stringArrayCallsTransformThreshold: 0.75,
              stringArrayEncoding: ['rc4'],
              stringArrayIndexShift: true,
              stringArrayRotate: true,
              stringArrayShuffle: true,
              stringArrayWrappersCount: 2,
              stringArrayWrappersChainedCalls: true,
              stringArrayWrappersParametersMaxCount: 4,
              stringArrayWrappersType: 'function',
              stringArrayThreshold: 0.75,
              transformObjectKeys: true,
              unicodeEscapeSequence: false,
            },
            apply: 'build',
          })
        : undefined,
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
      sourcemap: isProduction && !isLocalActive ? false : true,
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: isProduction && !isLocalActive,
          drop_debugger: isProduction && !isLocalActive,
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
  };
});
