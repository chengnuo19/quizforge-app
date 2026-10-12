import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// QuizForge dev/build config. Markdown quizzes in /content are imported as raw
// strings via import.meta.glob (see src/quiz/books.js).
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'QuizForge',
        short_name: 'QuizForge',
        description: '把题目、答案与详解整理进笔记本，随时开始可交互的测验。',
        theme_color: '#cc785c',
        background_color: '#faf9f5',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,ttf,otf}'],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}', 'electron/**/*.test.cjs'],
    setupFiles: ['./vitest.setup.js'],
  },
})
