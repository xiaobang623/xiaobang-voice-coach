import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api/generate-report": {
        target: "http://localhost:8090",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/api/extract-memory": {
        target: "http://localhost:8090",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/api/log-usage": {
        target: "http://localhost:8090",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/api/persist-session": {
        target: "http://localhost:3099",
        changeOrigin: true,
      },
      // Local api/*.js handlers. Run: npm run dev:api
      "/api/admin": {
        target: "http://localhost:3099",
        changeOrigin: true,
      },
      "/api/voice-backend-config": {
        target: "http://localhost:3099",
        changeOrigin: true,
      },
    },
  },
});
