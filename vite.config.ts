import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { componentTagger } from "lovable-tagger";

const appVersion = JSON.parse(readFileSync(new URL("./server/package.json", import.meta.url), "utf8")).version;
let buildRevision = process.env.GIT_COMMIT || "development";
try { buildRevision = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* Source archives use the deployment-provided revision. */ }

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: { __APP_VERSION__: JSON.stringify(appVersion), __BUILD_REVISION__: JSON.stringify(buildRevision) },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
    dedupe: ["react", "react-dom"],
  },
  build: {
    // Keep feature workspaces lazy-loaded instead of raising the chunk warning threshold.
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, "/");
          if (/\/node_modules\/(react|react-dom|react-router|react-router-dom)\//.test(normalizedId)) return "vendor-react";
          if (normalizedId.includes("/node_modules/recharts/")) return "vendor-charts";
        },
      },
    },
  },
}));
