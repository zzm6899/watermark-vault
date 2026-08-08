import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
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
    // Admin is now split at feature boundaries (payments, portfolio, imports,
    // ZIP operations). Keep the remaining workspace shell under a deliberate
    // 600 kB ceiling while those routes continue to be extracted incrementally.
    chunkSizeWarningLimit: 600,
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
