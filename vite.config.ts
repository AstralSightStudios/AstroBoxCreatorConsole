import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import monacoEditorPluginModule from "vite-plugin-monaco-editor-esm";

const monacoEditorPlugin =
  (monacoEditorPluginModule as unknown as { default: typeof monacoEditorPluginModule })
    .default ?? monacoEditorPluginModule;

export default defineConfig({
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
});
