import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import vueDevTools from 'vite-plugin-vue-devtools'
import AutoImport from 'unplugin-auto-import/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    vueDevTools(),
    // https://github.com/antfu/unplugin-auto-import
    AutoImport({
      // dts: "src/auto-imports.d.ts",
      vueTemplate: true,
      // global imports to register
      imports: ['vue', '@vueuse/core'],
      // Auto import for module exports under directories
      dirs: ['src/composables', 'src/utils', 'src/stores'],
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
