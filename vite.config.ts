import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vueDevTools from "vite-plugin-vue-devtools";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    // https://github.com/antfu/unplugin-auto-import
    AutoImport({
      // dts: "src/auto-imports.d.ts",
      vueTemplate: true,
      // global imports to register
      imports: ["vue", "@vueuse/core"],
      // Auto import for module exports under directories
      dirs: ["src/composables", "src/utils", "src/stores"],
    }),
    // https://unplugin.unjs.io/showcase/unplugin-vue-components.html
    Components({
      dts: true,
      resolvers: [],
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        silenceDeprecations: [
          "import",
          "global-builtin",
          "color-functions",
          "if-function",
        ],
      },
    },
  },
});
