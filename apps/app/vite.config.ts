import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// npm run dev: the app on http://localhost:5173, passing the API and the live sync's WebSocket on to the
// server on :3000 (npm run dev at the repository's root starts both).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/sync": { target: "ws://localhost:3000", ws: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
