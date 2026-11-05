// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const appVersion =
  process.env["CF_PAGES_COMMIT_SHA"]?.slice(0, 7) ??
  process.env["GITHUB_SHA"]?.slice(0, 7) ??
  "development";
const deploymentHost = process.env["CF_PAGES_URL"]
  ? new URL(process.env["CF_PAGES_URL"]).hostname
  : "";
const cloudflareVersionCandidate = deploymentHost.split(".")[0] ?? "";
const cloudflareVersion = /^[\da-f]{8}$/i.test(cloudflareVersionCandidate)
  ? cloudflareVersionCandidate
  : "";

export default defineConfig({
  nitro: {
    preset:
      process.env["npm_lifecycle_event"] === "build:pages"
        ? "cloudflare-pages"
        : "cloudflare-module",
  },
  vite: {
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
      "import.meta.env.VITE_CLOUDFLARE_VERSION": JSON.stringify(cloudflareVersion),
    },
    worker: { format: "es" },
    optimizeDeps: {
      exclude: ["maplibre-gl", "maplibre-gl-worker.mjs"],
    },
  },
  tanstackStart: {
    server: { entry: "server" },
  },
});
