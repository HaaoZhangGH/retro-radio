import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Use relative base so it works on GitHub Pages subpaths.
  base: "./",
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      manifest: {
        name: "Retro Radio",
        short_name: "Retro Radio",
        description: "A retro radio toy with Web Audio visualizer.",
        start_url: ".",
        scope: ".",
        display: "standalone",
        background_color: "#e5e5e5",
        theme_color: "#111111",
        icons: [
          {
            src: "icons/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        navigateFallback: "index.html",
        globPatterns: ["**/*.{js,css,html,svg,json,woff2,png}"]
      }
    })
  ]
});
