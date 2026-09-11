import { defineConfig } from "vite";

// Local-only bridge: forwards /api and /local-model to the local CV microservice
export default defineConfig({
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/local-model": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/local-model/, ""),
      },
    },
  },
});
