// The server as one file (dist/server.mjs) for the Docker image: everything bundled in but
// better-sqlite3, which is native and is installed next to it.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/server.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  external: ["better-sqlite3"],
  sourcemap: true,
  legalComments: "none",
  // (some bundled packages are CommonJS and call require)
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "info",
});
