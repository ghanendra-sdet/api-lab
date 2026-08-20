import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Base path defaults to "/" for local dev/preview. GitHub Pages project sites
// are served from https://<user>.github.io/<repo>/, so the deploy workflow
// sets VITE_BASE_PATH=/<repo>/ at build time (see .github/workflows/deploy-pages.yml).
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [react()],
  server: {
    port: 5173,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["**/node_modules/**", "**/e2e/**"],
  },
});
