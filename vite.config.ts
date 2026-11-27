import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

const BUILD_ID = (process.env.RENDER_GIT_COMMIT || '').slice(0, 12) || String(Date.now());
const BUILT_AT = new Date().toISOString();

function lgplastBuildVersionPlugin(): Plugin {
  return {
    name: 'lgplast-build-version-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ buildId: BUILD_ID, builtAt: BUILT_AT }, null, 2),
      });
    },
  };
}

export default defineConfig(() => {
  return {
    define: {
      __APP_BUILD_ID__: JSON.stringify(BUILD_ID),
      __APP_BUILT_AT__: JSON.stringify(BUILT_AT),
    },
    plugins: [
      react(),
      tailwindcss(),
      lgplastBuildVersionPlugin(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: false,
        includeAssets: [],
        manifest: {
          id: '/',
          name: 'LG PLAST PlantOps - Live Operations APK',
          short_name: 'LG PLAST',
          description: 'LG PLAST Plant Operations, Downtime, Dispatch & Quality APK with 24/7 offline cache and real-time Firebase sync.',
          theme_color: '#0f2f66',
          background_color: '#0f2f66',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          importScripts: ['/push-sw.js'],
          globPatterns: [
            'icon.svg',
            'apple-touch-icon.png',
            'push-sw.js',
            'assets/*.{js,css,png,jpg,jpeg,webp,svg,woff,woff2}',
            'assets/aistudio/image_65f70fd7.png',
          ],
          globIgnores: [
            '**/node_modules/**/*',
            'assets/aistudio/*.html',
            'assets/aistudio/*.csv',
            'assets/aistudio/*.zip',
          ],
          navigateFallback: null,
          ignoreURLParametersMatching: [/^v$/, /^t$/],
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.mode === 'navigate',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'lgplast-html-nav-v1',
                networkTimeoutSeconds: 3,
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 7 * 24 * 60 * 60,
                },
              },
            },
          ],
          dontCacheBustURLsMatching: /^assets\/[^/]+-[A-Za-z0-9_-]{8,}\./,
          maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve('.'),
      },
    },
    build: {
      chunkSizeWarningLimit: 600,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: 'vendor-react',
                test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
                priority: 40,
              },
              {
                name: 'vendor-firebase-firestore',
                test: /[\\/]node_modules[\\/](firebase[\\/]firestore|@firebase[\\/]firestore)[\\/]/,
                priority: 35,
              },
              {
                name: 'vendor-firebase-core',
                test: /[\\/]node_modules[\\/](firebase|@firebase)[\\/]/,
                priority: 30,
              },
              {
                name: 'vendor-fflate',
                test: /[\\/]node_modules[\\/]fflate[\\/]/,
                priority: 30,
              },
              {
                name: 'vendor-pdf',
                test: /[\\/]node_modules[\\/](jspdf|jspdf-autotable)[\\/]/,
                priority: 30,
              },
              {
                name: 'vendor-ui',
                test: /[\\/]node_modules[\\/](lucide-react|motion|framer-motion)[\\/]/,
                priority: 25,
              },
              {
                name: 'data-attendance',
                test: /[\\/]src[\\/]data[\\/]historicalAttendance\.json/,
                priority: 22,
              },
              {
                name: 'data-seeds',
                test: /[\\/]src[\\/]data[\\/]/,
                priority: 20,
              },
            ],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
