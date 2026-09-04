import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // The React console is mounted below the existing blog at /agent/.
  base: "/agent/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8123",
        changeOrigin: true
      }
    }
  }
});
