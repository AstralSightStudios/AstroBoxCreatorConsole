import tailwindcss from "@tailwindcss/vite";
import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import monacoEditorPluginModule from "vite-plugin-monaco-editor-esm";

const monacoEditorPlugin =
  (monacoEditorPluginModule as unknown as { default: typeof monacoEditorPluginModule })
    .default ?? monacoEditorPluginModule;

const tauriDevHost = process.env.TAURI_DEV_HOST;

function readGitState(): { commitSha: string; dirty: boolean } {
  try {
    const commitSha = execSync("git rev-parse HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const dirty =
      execSync("git status --porcelain", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim().length > 0;
    return { commitSha, dirty };
  } catch {
    return { commitSha: "", dirty: false };
  }
}

/**
 * Beta 更新检测需要的构建身份。
 *
 * CI 在 workflow 中设置 ABCC_CI_RUN_NUMBER / ABCC_CI_RUN_ATTEMPT /
 * ABCC_BUILD_COMMIT；本地构建则回退到 git HEAD 与工作区状态。
 * 通过 `define` 注入为字面量，避免把这些值暴露成可被运行时篡改的环境变量。
 */
function resolveBuildInfo() {
  const git = readGitState();
  const ciRunNumber = Number(process.env.ABCC_CI_RUN_NUMBER ?? "") || 0;
  const ciRunAttempt = Number(process.env.ABCC_CI_RUN_ATTEMPT ?? "") || 0;
  const ciCommit = (process.env.ABCC_BUILD_COMMIT ?? "").trim().toLowerCase();

  return {
    ciRunNumber,
    ciRunAttempt,
    commitSha: ciCommit || git.commitSha,
    // CI 默认是干净检出；本地构建只要工作区有改动就标记为 dirty。
    sourceDirty:
      process.env.ABCC_BUILD_SOURCE_DIRTY === "1" || (!ciCommit && git.dirty),
  };
}

export default defineConfig({
  define: {
    __ABCC_BUILD_INFO__: JSON.stringify(resolveBuildInfo()),
  },
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
