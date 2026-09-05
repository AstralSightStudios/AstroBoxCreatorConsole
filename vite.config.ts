import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import monacoEditorPluginModule from "vite-plugin-monaco-editor-esm";

const monacoEditorPlugin =
  (monacoEditorPluginModule as unknown as { default: typeof monacoEditorPluginModule })
    .default ?? monacoEditorPluginModule;

const tauriDevHost = process.env.TAURI_DEV_HOST;

export default defineConfig({
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  plugins: [
    tailwindcss(),
    react(),
    svgr(),
    tsconfigPaths(),
    monacoEditorPlugin({
      languageWorkers: [],
      customWorkers: [
        {
          label: "editorWorkerService",
          entry: "monaco-editor/esm/vs/editor/editor.worker.js",
        },
        {
          label: "json",
          entry: "monaco-editor/esm/vs/language/json/json.worker.js",
        },
      ],
    }),
  ],
  server: {
    host: tauriDevHost || false,
    port: 6767,
    strictPort: true,
    hmr: tauriDevHost
      ? {
          protocol: "ws",
          host: tauriDevHost,
          port: 6768,
        }
      : undefined,
    allowedHosts: [".trycloudflare.com", ".ts.net"],
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    proxy: {
      "/github-login": {
        target: "https://github.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/github-login/, ""),
      },
      "/github-api": {
        target: "https://api.github.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/github-api/, ""),
      },
      "/github-raw": {
        target: "https://raw.githubusercontent.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/github-raw/, ""),
      },
    },
  },
});
