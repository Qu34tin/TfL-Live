// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  nitro: {
    preset:
      process.env["npm_lifecycle_event"] === "build:pages"
        ? "cloudflare-pages"
        : "cloudflare-module",
  },
  vite: {
    worker: { format: "es" },
    optimizeDeps: {
      exclude: ["maplibre-gl", "maplibre-gl-worker.mjs"],
    },
  },
  tanstackStart: {
    server: { entry: "server" },
  },
});
