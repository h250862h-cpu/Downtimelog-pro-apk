import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
          'push-sw.js',
          'assets/aistudio/image_65f70fd7.png',
        ],
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
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
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
                name: 'vendor-xlsx',
                test: /[\\/]node_modules[\\/]xlsx[\\/]/,
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
