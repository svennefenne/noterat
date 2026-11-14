import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// npm run dev: the app on http://localhost:5173, passing /api on to the server on :3000 (npm run dev at the
// repository's root starts both).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000" },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
