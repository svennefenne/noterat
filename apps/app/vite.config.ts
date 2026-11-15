import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Which build this is (decision 16): the version from the repository's package.json, and the build, the
 * number of commits (as the APK's version code, the desktop app's and the server's), so every copy of the
 * app can tell an older one from a newer one. CI passes NOTERAT_BUILD and NOTERAT_SHA; a checkout asks git.
 */
function buildInfo() {
  const root = new URL("../../", import.meta.url);
  const git = (args: string) => {
    try {
      return execSync(`git ${args}`, { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
    } catch {
      return "";
    }
  };
  const { version } = JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as { version: string };
  return {
    version,
    build: Number(process.env.NOTERAT_BUILD) || Number(git("rev-list --count HEAD")) || 0,
    sha: (process.env.NOTERAT_SHA || git("rev-parse HEAD")).slice(0, 7),
  };
}

const info = buildInfo();

/** version.json beside the build, for the desktop app's shell (which keeps a copy of the build) */
const versionFile: Plugin = {
  name: "noterat-version",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "version.json", source: `${JSON.stringify(info)}\n` });
  },
};

// npm run dev: the app on http://localhost:5173, passing the API and the live sync's WebSocket on to the
// server on :3000 (npm run dev at the repository's root starts both).
export default defineConfig({
  plugins: [react(), versionFile],
  define: { __NOTERAT_BUILD__: JSON.stringify(info) },
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
